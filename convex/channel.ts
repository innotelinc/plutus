import { query, mutation, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

// ─── Seed: ensure default channel exists ──────────────────

export const ensureChannel = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();

    if (existing) return existing._id;

    const channelId = await ctx.db.insert("channels", {
      slug: "main",
      name: "PLUTUS",
      status: "standby",
      segmentSeconds: 10,
      offline: false,
      items: [],
      pending: [],
    });

    return channelId;
  },
});

// ─── Channel snapshot (for the live page) ─────────────────

export const getChannel = query({
  args: {},
  handler: async (ctx) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();

    if (!channel) return null;

    // Fetch schedule entries
    // Get newest 200 entries (reverse to chronological order)
    const scheduleDocs = (await ctx.db
      .query("schedule")
      .withIndex("by_channel_start", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .take(200)).reverse();

    // Enrich schedule with item + clip data
    const schedule = await Promise.all(
      scheduleDocs.map(async (entry) => {
        const item = await ctx.db.get(entry.itemId);
        const clip = await ctx.db.get(entry.clipId);
        return {
          id: `${entry.clipId}@${entry.startAt}`,
          startAt: entry.startAt,
          duration: entry.durationMs / 1000,
          item: item ? {
            id: item._id,
            itemNumber: item.itemNumber,
            title: item.title,
            url: item.url,
            image: item.image,
            price: item.price,
            generationDone: item.generationDone,
            newestClipAt: item.newestClipAt,
            endless: false, // MVP: no endless generation
          } : null,
          clip: clip ? {
            id: clip._id,
            videoUrl: clip.videoUrl,
            duration: clip.durationMs / 1000,
            dialogue: clip.dialogue,
            source: clip.source,
            askedBy: clip.askedBy,
          } : null,
        };
      })
    );

    // Fetch rotation items (ready)
    const itemDocs = await ctx.db
      .query("items")
      .withIndex("by_status", (q) => q.eq("channelId", channel._id).eq("status", "ready"))
      .take(200);

    const rotation = itemDocs.map((item) => ({
      id: item._id,
      itemNumber: item.itemNumber,
      title: item.title,
      url: item.url,
      image: item.image,
      price: item.price,
      generationDone: item.generationDone,
      playbackSeconds: item.playbackSeconds ?? 0,
      newestClipAt: item.newestClipAt ?? 0,
    }));

    // Fetch pending items (queued or working)
    const pendingDocs = await ctx.db
      .query("items")
      .withIndex("by_status", (q) =>
        q.eq("channelId", channel._id).eq("status", "queued")
      )
      .take(50);

    const workingDocs = await ctx.db
      .query("items")
      .withIndex("by_status", (q) =>
        q.eq("channelId", channel._id).eq("status", "working")
      )
      .take(50);

    const pending = [...pendingDocs, ...workingDocs].map((item) => ({
      id: item._id,
      itemNumber: item.itemNumber,
      title: item.title,
      url: item.url,
      image: item.image,
    }));

    // Fetch recent chat (last 200)
    const chatDocs = await ctx.db
      .query("chat")
      .withIndex("by_channel_created", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .take(200);

    const chat = chatDocs.reverse().map((c) => ({
      id: c._id,
      user: c.sender,
      text: c.text,
      role: c.role,
    }));

    return {
      serverNow: Date.now(),
      offline: channel.offline,
      segmentSeconds: channel.segmentSeconds,
      schedule,
      rotation,
      pending,
      chat,
    };
  },
});

// ─── Submit product ───────────────────────────────────────

// --- URL validation (SSRF protection) ---

const BLOCKED_HOST_PATTERNS =
  /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fe80:|localhost)/i;

function validateProductUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (BLOCKED_HOST_PATTERNS.test(parsed.hostname.toLowerCase())) return null;
  return parsed.href;
}

export const submitProduct = mutation({
  args: {
    url: v.string(),
    title: v.optional(v.string()),
    price: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // --- SSRF: validate URL on the backend ---
    const validatedUrl = validateProductUrl(args.url);
    if (!validatedUrl) throw new Error("Invalid product URL");

    // --- Rate limit: max 5 queued/working items in the last 10 minutes ---
    const tenMinAgo = Date.now() - 600_000;
    const ch = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();
    if (ch) {
      const recentQueued = await ctx.db
        .query("items")
        .withIndex("by_status", (q) =>
          q.eq("channelId", ch._id).eq("status", "queued"),
        )
        .filter((q) => q.gt(q.field("_creationTime"), tenMinAgo))
        .take(10);
      const recentWorking = await ctx.db
        .query("items")
        .withIndex("by_status", (q) =>
          q.eq("channelId", ch._id).eq("status", "working"),
        )
        .filter((q) => q.gt(q.field("_creationTime"), tenMinAgo))
        .take(10);
      if (recentQueued.length + recentWorking.length >= 5) {
        throw new Error("Too many submissions. Please wait a few minutes.");
      }
    }

    // Ensure channel exists
    let channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();

    if (!channel) {
      const channelId = await ctx.db.insert("channels", {
        slug: "main",
        name: "PLUTUS",
        status: "standby",
        segmentSeconds: 10,
        offline: false,
        items: [],
        pending: [],
      });
      channel = await ctx.db.get(channelId);
    }

    if (!channel) throw new Error("Failed to create channel");
    const channelId = channel._id;

    // Generate item number: PX-<max+1> (avoids collision after deletion)
    const allItems = await ctx.db
      .query("items")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    const maxNum = allItems.reduce((max, it) => {
      const n = parseInt(it.itemNumber.replace("PX-", ""), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 1000);
    const itemNumber = `PX-${maxNum + 1}`;

    const itemId = await ctx.db.insert("items", {
      channelId,
      url: validatedUrl,
      title: args.title ?? "Processing…",
      price: args.price,
      image: args.image,
      itemNumber,
      status: "queued",
      generationDone: false,
      playbackSeconds: 0,
    });

    // Add to channel pending list
    await ctx.db.patch(channelId, {
      pending: [...channel.pending, itemId],
      status: channel.status === "offline" ? "offline" : "live",
    });

    return { itemId, itemNumber };
  },
});

// ─── Send chat message ───────────────────────────────────

export const sendChat = mutation({
  args: {
    sender: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();

    if (!channel) throw new Error("Channel not found");

    await ctx.db.insert("chat", {
      channelId: channel._id,
      sender: args.sender,
      text: args.text,
      role: "viewer" as const,
    });
  },
});

// ─── Viewer identity (SSO via Cerulean Authentik) ────────────────
// Called from the /auth/callback HTTP action to keep the viewers table in
// sync with Authentik sessions. Idempotent per viewerId.

export const upsertViewer = mutation({
  args: {
    viewerId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    groups: v.array(v.string()),
    isAdmin: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("viewers")
      .withIndex("by_viewerId", (q) => q.eq("viewerId", args.viewerId))
      .first();
    const fields = {
      name: args.name,
      email: args.email,
      groups: args.groups,
      isAdmin: args.isAdmin,
      lastSeenAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { viewerId: args.viewerId, upserted: false };
    }
    await ctx.db.insert("viewers", { viewerId: args.viewerId, ...fields });
    return { viewerId: args.viewerId, upserted: true };
  },
});

// ─── Seed mock data (P1 testing) ────────────────────────────────
// Inserts 3 mock items with clips + schedule entries for playback testing.
// Clips are self-hosted: branded MP4s under /demo/ (see scripts/make-demo-clips.sh),
// served by nginx from the static export — no external video host involved.

const MOCK_VIDEOS = [
  { url: "/demo/demo-1.mp4", title: "Welcome to PLUTUS", price: "$19.99", dialogue: "Welcome to PLUTUS! Today's first feature is live from your own studio — shopping, auto-generated in video.", image: "/demo/demo-1.png" },
  { url: "/demo/demo-2.mp4", title: "Studio Lights", price: "$24.99", dialogue: "Our second feature — every clip you see was generated on this very host, no cloud required.", image: "/demo/demo-2.png" },
  { url: "/demo/demo-3.mp4", title: "Zero Cloud", price: "$9.99", dialogue: "And now, an encore presentation — zero external video APIs, fully self-hosted, always on air.", image: "/demo/demo-3.png" },
];

export const seedMockData = mutation({
  args: {},
  handler: async (ctx) => {
    // Ensure channel
    let channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();

    if (!channel) {
      const channelId = await ctx.db.insert("channels", {
        slug: "main",
        name: "PLUTUS",
        status: "standby",
        segmentSeconds: 10,
        offline: false,
        items: [],
        pending: [],
      });
      channel = await ctx.db.get(channelId)!;
    }

    // Check if already seeded
    const existingClips = await ctx.db
      .query("clips")
      .withIndex("by_channel_status", (q) => q.eq("channelId", channel!._id))
      .first();
    if (existingClips) {
      return { seeded: false, message: "Mock data already exists" };
    }

    const now = Date.now();
    // Start schedule 5 seconds from now to allow client to load
    let scheduleStart = now + 5000;
    const itemIds: Id<"items">[] = [];
    const clipIds: Id<"clips">[] = [];

    // Create one item + clip per demo video (10s each)
    for (let i = 0; i < MOCK_VIDEOS.length; i++) {
      const mv = MOCK_VIDEOS[i];

      const itemId = await ctx.db.insert("items", {
        channelId: channel!._id,
        url: mv.url,
        title: mv.title,
        price: mv.price,
        image: mv.image,
        itemNumber: `PX-${1000 + i + 1}`,
        status: "ready",
        generationDone: true,
        playbackSeconds: 0,
      });
      itemIds.push(itemId);

      const clipId = await ctx.db.insert("clips", {
        channelId: channel!._id,
        itemId,
        videoUrl: mv.url,
        durationMs: 10000,
        dialogue: mv.dialogue,
        source: "normal",
        status: "ready",
        retryCount: 0,
        clipIndex: 0,
      });
      clipIds.push(clipId);
    }

    // Air the demo round-robin for a few cycles so the channel plays
    // continuously instead of dropping to standby after the first 30s.
    // The rotateSchedule cron keeps topping the schedule up afterwards,
    // so the seeded loop is just the warm-up runway.
    const LOOP_CYCLES = 4; // 4 × 3 clips × 10s = 2 minutes of airtime
    for (let cycle = 0; cycle < LOOP_CYCLES; cycle++) {
      for (let i = 0; i < MOCK_VIDEOS.length; i++) {
        await ctx.db.insert("schedule", {
          channelId: channel!._id,
          itemId: itemIds[i],
          clipId: clipIds[i],
          startAt: scheduleStart,
          durationMs: 10000,
        });
        scheduleStart += 10000; // next clip starts after this one
      }
    }

    // Update channel
    await ctx.db.patch(channel!._id, {
      items: itemIds,
      pending: [],
      status: "live",
    });

    return { seeded: true, clipCount: MOCK_VIDEOS.length, startsAt: now + 5000 };
  },
});

export const clearMockData = mutation({
  args: { adminKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // --- Require admin key to prevent unauthorized data wipe ---
    if (args.adminKey !== process.env.ADMIN_SECRET) {
      throw new Error("Unauthorized: admin key required");
    }
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();
    if (!channel) return { cleared: false };

    // Delete all schedule entries
    const schedules = await ctx.db
      .query("schedule")
      .withIndex("by_channel_start", (q) => q.eq("channelId", channel._id))
      .collect();
    for (const s of schedules) await ctx.db.delete(s._id);

    // Delete all clips
    const clips = await ctx.db
      .query("clips")
      .withIndex("by_channel_status", (q) => q.eq("channelId", channel._id))
      .collect();
    for (const c of clips) await ctx.db.delete(c._id);

    // Delete all items (mock ones only — those with status "ready")
    const items = await ctx.db
      .query("items")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .collect();
    for (const it of items) await ctx.db.delete(it._id);

    // Reset channel
    await ctx.db.patch(channel._id, {
      items: [],
      pending: [],
      status: "standby",
    });

    return { cleared: true, deletedSchedule: schedules.length, deletedClips: clips.length, deletedItems: items.length };
  },
});

// ─── Get item status (for polling) ───────────────────────

export const getItem = query({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    return {
      id: item._id,
      itemNumber: item.itemNumber,
      title: item.title,
      url: item.url,
      image: item.image,
      price: item.price,
      status: item.status,
      error: item.error,
    };
  },
});

// ─── Rotate schedule (cron-triggered) ─────────────────────
// When the schedule is about to end, re-queue rotation items' clips.
// Round-robin: starts from the next item after the last played one.
// Adds enough cycles to cover at least 2 minutes of future content.

export const rotateSchedule = internalMutation({
  args: {},
  handler: async (ctx) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();
    if (!channel) return { rotated: false, reason: "no channel" };

    // Get the last schedule entry
    const lastEntry = await ctx.db
      .query("schedule")
      .withIndex("by_channel_start", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .first();
    if (!lastEntry) return { rotated: false, reason: "no schedule" };

    const lastEndAt = lastEntry.startAt + lastEntry.durationMs;
    const now = Date.now();

    // Only rotate if schedule ends within 60 seconds (or already ended)
    if (lastEndAt > now + 60_000) return { rotated: false, reason: "not ending soon" };

    // Get rotation items
    const rotationIds = channel.items;
    if (rotationIds.length === 0) return { rotated: false, reason: "no rotation items" };

    // Round-robin: find the next item after the last played one
    const lastIndex = rotationIds.findIndex((id) => id === lastEntry.itemId);
    let nextIndex = lastIndex >= 0 ? (lastIndex + 1) % rotationIds.length : 0;

    // Add rotation cycles until we have at least 2 minutes of future content
    let scheduleStart = Math.max(lastEndAt, now + 2000);
    let added = 0;
    const targetEnd = now + 120_000; // 2 minutes from now
    let safety = 0;

    while (scheduleStart < targetEnd && safety < 100) {
      const itemId = rotationIds[nextIndex % rotationIds.length];

      // Get this item's ready clips, ordered by clipIndex
      const allClips = await ctx.db
        .query("clips")
        .withIndex("by_item", (q) => q.eq("itemId", itemId))
        .collect();
      const readyClips = allClips
        .filter((c) => c.status === "ready")
        .sort((a, b) => a.clipIndex - b.clipIndex);

      for (const clip of readyClips) {
        await ctx.db.insert("schedule", {
          channelId: channel._id,
          itemId,
          clipId: clip._id,
          startAt: scheduleStart,
          durationMs: clip.durationMs,
        });
        scheduleStart += clip.durationMs;
        added++;
      }

      nextIndex++;
      safety++;
    }

    // Ensure channel is live
    if (channel.status !== "live") {
      await ctx.db.patch(channel._id, { status: "live" });
    }

    return { rotated: true, added };
  },
});

// --- Recover stuck items (cron-triggered every 5 min) ---
// Marks items stuck in "working" for too long as failed so the UI shows an
// error instead of spinning forever. The threshold is 15 min: H3 video
// renders through MuAPI (open-generative-ai flow) are slower than fal's
// turbo endpoint, so give the pipeline headroom before recovering.

export const recoverStuckItems = internalMutation({
  args: {},
  handler: async (ctx) => {
    const fifteenMinAgo = Date.now() - 900_000;
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", (q) => q.eq("slug", "main"))
      .first();
    if (!channel) return { recovered: 0 };
    const stuck = await ctx.db
      .query("items")
      .withIndex("by_status", (q) => q.eq("channelId", channel._id).eq("status", "working"))
      .filter((q) => q.lt(q.field("_creationTime"), fifteenMinAgo))
      .collect();
    for (const item of stuck) {
      await ctx.db.patch(item._id, {
        status: "failed",
        error: "Generation timed out",
      });
      // Remove from pending
      const channel = await ctx.db.get(item.channelId);
      if (channel) {
        await ctx.db.patch(item.channelId, {
          pending: channel.pending.filter((id) => id !== item._id),
        });
      }
    }
    return { recovered: stuck.length };
  },
});

