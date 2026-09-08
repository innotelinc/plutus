import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import * as cheerio from "cheerio";

// ─── External AI services ──────────────────────────────────────────────────────
//
// Video generation — OmniRoute image model + ffmpeg minterpolate
//   3 keyframes per clip via an image model through OmniRoute, animated with
//   ffmpeg minterpolate. Fully open-source, self-hosted. Controlled by
//   OMNIROUTE_IMAGE_MODEL (default: "auto").
//
// Product scripting — OpenClaw / OpenClaude via OmniRoute
//   OmniRoute (github.com/diegosouzapw/OmniRoute) fronts 350+ providers.
//   Scripts are generated via chat/completions. Configure via OMNIROUTE_*.
//
// Fallback clips — procedural keyframes + ffmpeg, always available.
//   When image generation fails, the fallback action generates 3 procedural
//   keyframes and animates them with ffmpeg minterpolate (same approach, no
//   external API needed).

const OMNIROUTE_BASE_URL =
  process.env.OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1";
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL ?? "auto";
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY;
const OMNIROUTE_IMAGE_MODEL =
  process.env.OMNIROUTE_IMAGE_MODEL ?? "auto";

const IMAGE_MODEL_MISSING = "OMNIROUTE_IMAGE_MODEL_MISSING";

// ─── Query: last schedule end time ────────────────────────────────────────────

export const getLastScheduleEnd = query({
  args: {},
  handler: async (ctx) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();
    if (!channel) return 0;

    const last = await ctx.db
      .query("schedule")
      .withIndex("by_channel_start", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .first();

    return last ? last.startAt + last.durationMs : 0;
  },
});

// ─── Mutations (called by the action to update DB) ────────────────────────────

export const updateItemDetails = mutation({
  args: {
    itemId: v.id("items"),
    title: v.string(),
    price: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      title: args.title,
      price: args.price,
      image: args.image,
    });
  },
});

export const markItemWorking = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, { status: "working" });
  },
});

export const addClipToSchedule = mutation({
  args: {
    itemId: v.id("items"),
    videoUrl: v.string(),
    dialogue: v.string(),
    clipIndex: v.number(),
    durationMs: v.number(),
    startAt: v.number(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const lastEntry = await ctx.db
      .query("schedule")
      .withIndex("by_channel_start", (q) => q.eq("channelId", item.channelId))
      .order("desc")
      .first();
    const realLastEnd = lastEntry ? lastEntry.startAt + lastEntry.durationMs : 0;
    const actualStart = Math.max(args.startAt, realLastEnd + 1000, Date.now() + 1000);

    const clipId = await ctx.db.insert("clips", {
      channelId: item.channelId,
      itemId: args.itemId,
      videoUrl: args.videoUrl,
      durationMs: args.durationMs,
      dialogue: args.dialogue,
      source: "normal",
      status: "ready",
      retryCount: 0,
      clipIndex: args.clipIndex,
    });

    await ctx.db.insert("schedule", {
      channelId: item.channelId,
      itemId: args.itemId,
      clipId,
      startAt: actualStart,
      durationMs: args.durationMs,
    });

    await ctx.db.patch(args.itemId, {
      newestClipAt: Date.now(),
    });

    return clipId;
  },
});

export const finalizeItem = mutation({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    await ctx.db.patch(args.itemId, {
      status: "ready",
      generationDone: true,
    });

    const channel = await ctx.db.get(item.channelId);
    if (channel) {
      await ctx.db.patch(item.channelId, {
        items: [...channel.items, args.itemId],
        pending: channel.pending.filter((id) => id !== args.itemId),
      });
    }
  },
});

export const failItem = mutation({
  args: {
    itemId: v.id("items"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    await ctx.db.patch(args.itemId, {
      status: "failed",
      error: args.error,
    });

    const channel = await ctx.db.get(item.channelId);
    if (channel) {
      await ctx.db.patch(item.channelId, {
        pending: channel.pending.filter((id) => id !== args.itemId),
      });
    }
  },
});

// ─── Pipeline Action ──────────────────────────────────────────────────────────

const CLIP_DURATION_MS = 10000;

interface ScriptClip {
  videoPrompt: string;
  dialogue: string;
}

const SYSTEM_PROMPT = `You are the scriptwriter for PixelShop, an AI shopping channel where an AI host presents products in generated video clips. Each clip is 10 seconds. You will receive product information and write 3 consecutive clips that form a complete product presentation.

Each clip has:
- videoPrompt: A visual description for the AI video model. Describe what the camera sees: the setting, the product, the host's actions. Include the spoken line in double quotes using this format: The host says, "line here" and continues without another word. Keep the full prompt under 420 characters. End with: Sound: ambient studio audio; the only spoken words are the exact quoted line, delivered clearly in English; all other voices are wordless.
- dialogue: The exact spoken line (shown as subtitle), extracted from the videoPrompt without quotes.

The 3 clips should follow this arc:
1. Introduction: Host introduces the product with excitement
2. Feature highlight: Host demonstrates or describes key features
3. Call to action: Host urges viewers to buy now

Return ONLY a JSON object with a "clips" array, no markdown fences:
{"clips": [{"videoPrompt": "...", "dialogue": "..."}]}`;

const FALLBACK_CLIPS: ScriptClip[] = [
  {
    videoPrompt: `A bright modern TV shopping studio with colorful lights. A charismatic host stands next to a product on a pedestal and gestures toward it with excitement. The host says, "Welcome to PixelShop! Today we have something amazing for you." and continues without another word. Sound: ambient studio audio; the only spoken words are the exact quoted line, delivered clearly in English; all other voices are wordless.`,
    dialogue: "Welcome to PixelShop! Today we have something amazing for you.",
  },
  {
    videoPrompt: `Close-up of a product on a pedestal in a bright TV shopping studio. A host gestures toward the product features with enthusiasm. The host says, "Look at this incredible design and quality." and continues without another word. Sound: ambient studio audio; the only spoken words are the exact quoted line, delivered clearly in English; all other voices are wordless.`,
    dialogue: "Look at this incredible design and quality.",
  },
  {
    videoPrompt: `A host in a TV shopping studio points toward a glowing BUY NOW button overlay. The host says, "Don't wait ++ buy now before it's gone!" and continues without another word. Sound: ambient studio audio; the only spoken words are the exact quoted line, delivered clearly in English; all other voices are wordless.`,
    dialogue: "Don't wait ++ buy now before it's gone!",
  },
];

// ─── Helper: scrape product page ──────────────────────────────────────────────

const BLOCKED_HOST_RE =
  /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fe80:|localhost)/i;

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (BLOCKED_HOST_RE.test(u.hostname.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

async function scrapeProduct(
  url: string,
): Promise<{ title?: string; price?: string; image?: string }> {
  if (!isSafeUrl(url)) return {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return {};
    const html = await response.text();
    const $ = cheerio.load(html);

    const rawTitle =
      $('meta[property="og:title"]').attr("content")?.trim() ||
      $("title").text().trim() ||
      "";
    let title: string | undefined = rawTitle.replace(/^Amazon\.com\s*:\s*/i, "").replace(/\s*:\s*\w+\s*$/, "").trim();
    if (title.length > 100) title = title.slice(0, 97) + "...";
    if (!title) title = undefined;

    const image =
      $('meta[property="og:image"]').attr("content")?.trim() ||
      $('meta[name="twitter:image"]').attr("content")?.trim() ||
      undefined;

    const rawPrice =
      $('[itemprop="price"]').attr("content")?.trim() ||
      $('meta[property="product:price:amount"]').attr("content")?.trim() ||
      "";
    let price: string | undefined;
    if (rawPrice && /^[\\\$\£\€\¥\¥\d.,\s]+/.test(rawPrice)) {
      price = rawPrice.slice(0, 20);
    } else {
      const priceText = $('[class*="price"], [id*="price"], [data-price]').first().text().trim();
      if (/^[\\\$\£\€\¥\¥]?[\d,]+\.?\d{0,2}/.test(priceText)) {
        price = priceText.slice(0, 20);
      }
    }

    return { title, price, image };
  } catch {
    return {};
  }
}

// ─── Helper: generate script via OmniRoute ────────────────────────────────────

function extractJson(text: string): { clips?: unknown } {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(cleaned) as { clips?: unknown };
  } catch {
    // keep going
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as { clips?: unknown };
    } catch {
      // keep going
    }
  }
  throw new Error("Scripting response was not valid JSON");
}

async function generateScript(
  title: string,
  price: string | undefined,
  url: string,
): Promise<ScriptClip[]> {
  try {
    const userPrompt = `Product: ${title}${price ? `\nPrice: ${price}` : ""}\nURL: ${url}\n\nWrite 3 clips for this product presentation.`;

    const endpoint = `${OMNIROUTE_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (OMNIROUTE_API_KEY) headers.Authorization = `Bearer ${OMNIROUTE_API_KEY}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: OMNIROUTE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1200,
        temperature: 0.8,
      }),
    });

    if (!response.ok) throw new Error(`OmniRoute scripting error: ${response.status}`);

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from scripting endpoint");

    const parsed = extractJson(content);
    const clips = parsed.clips;
    if (!Array.isArray(clips) || clips.length === 0)
      throw new Error("Invalid script format");

    return clips
      .map((c: { videoPrompt?: string; dialogue?: string }) => ({
        videoPrompt:
          typeof c.videoPrompt === "string"
            ? c.videoPrompt.slice(0, 500)
            : FALLBACK_CLIPS[0].videoPrompt,
        dialogue:
          typeof c.dialogue === "string"
            ? c.dialogue.slice(0, 200)
            : FALLBACK_CLIPS[0].dialogue,
      }))
      .slice(0, 3);
  } catch (e) {
    console.error("Script generation failed, using fallback clips:", e);
    return FALLBACK_CLIPS;
  }
}

// ─── Helper: generate video via T2I keyframes + ffmpeg minterpolate ──────────
// Calls the videoAction module which runs in Node.js runtime.

async function generateOpenVideo(
  ctx: any,
  prompt: string,
): Promise<string> {
  return await ctx.runAction(api.videoAction.generateOpenVideo, { prompt });
}

// ─── Helper: generate fallback clip (procedural) ──────────────────────────────

async function generateFallbackClip(ctx: any, prompt: string): Promise<string> {
  const result = await ctx.runAction(api.videoAction.generateFallbackClip, { prompt });
  return result as string;
}

// ─── The pipeline action ──────────────────────────────────────────────────────

export const runPipeline = action({
  args: { itemId: v.id("items") },
  handler: async (ctx, args): Promise<void> => {
    try {
      // 1. Get item details
      const item = await ctx.runQuery(api.channel.getItem, {
        itemId: args.itemId,
      });
      if (!item) throw new Error("Item not found");

      let title = item.title;
      let price = item.price;
      let image = item.image;

      // 2. Scrape URL if title is still placeholder
      if (title === "Processing…") {
        const scraped = await scrapeProduct(item.url);
        if (scraped.title) title = scraped.title;
        if (scraped.price) price = scraped.price;
        if (scraped.image) image = scraped.image;
        if (title === "Processing…") title = "Untitled Product";

        await ctx.runMutation(api.pipeline.updateItemDetails, {
          itemId: args.itemId,
          title,
          price,
          image,
        });
      }

      // 3. Mark item as working
      await ctx.runMutation(api.pipeline.markItemWorking, {
        itemId: args.itemId,
      });

      // 4. Generate script through OmniRoute
      const clips = await generateScript(title, price, item.url);

      // 5. Calculate schedule start
      const lastEndAt = await ctx.runQuery(api.pipeline.getLastScheduleEnd, {});
      let scheduleStart = Math.max(Date.now() + 3000, lastEndAt + 1000);

      // 6. Generate videos (T2I + ffmpeg), fallback to procedural clips
      let successCount = 0;
      let imageModelMissing = false;
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        let clipSuccess = false;

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const videoUrl = await generateOpenVideo(ctx, clip.videoPrompt);
            const hintStart = Math.max(scheduleStart, Date.now() + 2000);

            await ctx.runMutation(api.pipeline.addClipToSchedule, {
              itemId: args.itemId,
              videoUrl: videoUrl,
              dialogue: clip.dialogue,
              clipIndex: i,
              durationMs: CLIP_DURATION_MS,
              startAt: hintStart,
            });

            scheduleStart = hintStart + CLIP_DURATION_MS;
            successCount++;
            clipSuccess = true;
            break;
          } catch (e) {
            const code = (e as Error & { code?: string }).code;
            if (code === IMAGE_MODEL_MISSING) imageModelMissing = true;
            console.error(`Clip ${i} attempt ${attempt + 1} failed:`, e);

            if (!clipSuccess) {
              try {
                const fallbackUrl = await generateFallbackClip(ctx, clip.videoPrompt);
                const hintStart = Math.max(scheduleStart, Date.now() + 2000);
                await ctx.runMutation(api.pipeline.addClipToSchedule, {
                  itemId: args.itemId,
                  videoUrl: fallbackUrl,
                  dialogue: clip.dialogue,
                  clipIndex: i,
                  durationMs: CLIP_DURATION_MS,
                  startAt: hintStart,
                });
                scheduleStart = hintStart + CLIP_DURATION_MS;
                successCount++;
                clipSuccess = true;
                console.log(`Clip ${i} used fallback clip at ${fallbackUrl}`);
                break;
              } catch (fallbackErr) {
                console.error(`Clip ${i} fallback also failed:`, fallbackErr);
              }
            }

            if (attempt === 0 && !clipSuccess) {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }

        if (!clipSuccess) {
          console.error(`Clip ${i} failed after 2 attempts, skipping`);
        }
      }

      // 7. Finalize or fail
      if (successCount === 0) {
        const error = imageModelMissing
          ? "Your segment was scripted, but the video studio needs OmniRoute connected to an image model to generate clips. Connect a provider (e.g. Stable Diffusion or Flux) in the OmniRoute dashboard, or set OMNIROUTE_IMAGE_MODEL to a specific model — then submit this product again."
          : "All clips failed to generate";
        await ctx.runMutation(api.pipeline.failItem, {
          itemId: args.itemId,
          error,
        });
        return;
      }

      await ctx.runMutation(api.pipeline.finalizeItem, {
        itemId: args.itemId,
      });
    } catch (e) {
      console.error("Pipeline failed:", e);
      try {
        await ctx.runMutation(api.pipeline.failItem, {
          itemId: args.itemId,
          error: e instanceof Error ? e.message : "Pipeline failed",
        });
      } catch {
        // If even failItem fails, nothing more we can do
      }
    }
  },
});
