"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import Image from "next/image";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types (matching Convex return) ───────────────────────

type ChannelData = {
  serverNow: number;
  offline: boolean;
  segmentSeconds: number;
  schedule: ScheduleEntry[];
  rotation: RotationItem[];
  pending: PendingItem[];
  chat: ChatMessage[];
};

type ScheduleEntry = {
  id: string;
  startAt: number;
  duration: number;
  item: {
    id: string;
    itemNumber: string;
    title: string;
    url: string;
    image?: string;
    price?: string;
    generationDone: boolean;
    newestClipAt?: number;
    endless: boolean;
  } | null;
  clip: {
    id: string;
    videoUrl?: string;
    duration: number;
    dialogue: string;
    source: "normal" | "question";
    askedBy?: string;
  } | null;
};

type RotationItem = {
  id: string;
  itemNumber: string;
  title: string;
  url: string;
  image?: string;
  price?: string;
  generationDone: boolean;
  playbackSeconds: number;
  newestClipAt: number;
};

type PendingItem = {
  id: string;
  itemNumber: string;
  title: string;
  url: string;
  image?: string;
};

type ChatMessage = {
  id: string;
  user: string;
  text: string;
  role: "viewer" | "host";
};

// ─── Helper: find current schedule position ──────────────

function findPosition(schedule: ScheduleEntry[], now: number) {
  for (let i = 0; i < schedule.length; i++) {
    const entry = schedule[i];
    const endAt = entry.startAt + entry.duration * 1000;
    if (now >= entry.startAt && now < endAt) {
      return { entry, index: i, offsetMs: now - entry.startAt };
    }
  }
  return null;
}

// --- Helper: hash string for color assignment ---

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ─── Color for chat usernames ────────────────────────────

const CHAT_COLORS = ["#ff2d78", "#ffd24a", "#38e8ff", "#8b5cf6", "#22c55e", "#f97316"];

function userColor(name: string) {
  return CHAT_COLORS[hashStr(name) % CHAT_COLORS.length];
}

// ─── Main Page ────────────────────────────────────────────

export default function HomePage() {
  const channel = useQuery(api.channel.getChannel, {});

  // Ensure channel exists on first load
  const ensureChannel = useMutation(api.channel.ensureChannel);
  useEffect(() => {
    ensureChannel({});
  }, [ensureChannel]);

  if (!channel) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="animate-spin h-8 w-8 rounded-full border-2 border-pink border-t-transparent" />
      </main>
    );
  }

  return <ChannelView data={channel} />;
}

// ─── Channel View ────────────────────────────────────────

function ChannelView({ data }: { data: ChannelData }) {
  const [muted, setMuted] = useState(true);
  const [selectedItem, setSelectedItem] = useState<RotationItem | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [clipIndex, setClipIndex] = useState<number>(-1);

  const skewRef = useRef(0);
  const [now, setNow] = useState(0);

  // Update clock (for UI display only — not for clip switching)
  useEffect(() => {
    if (data.serverNow) {
      skewRef.current = data.serverNow - Date.now();
    }
    const interval = setInterval(() => {
      setNow(Date.now() + skewRef.current);
    }, 250);
    return () => clearInterval(interval);
  }, [data.serverNow]);

  // Initialize clipIndex on first load using server time
  useEffect(() => {
    if (clipIndex < 0 && data.schedule.length > 0 && data.serverNow) {
      const pos = findPosition(data.schedule, Date.now() + skewRef.current);
      setClipIndex(pos?.index ?? 0);
    }
  }, [data.schedule, data.serverNow, clipIndex, skewRef]);

  const currentEntry = clipIndex >= 0 && clipIndex < data.schedule.length
    ? data.schedule[clipIndex]
    : null;
  const nextEntry = clipIndex >= 0 && clipIndex + 1 < data.schedule.length
    ? data.schedule[clipIndex + 1]
    : null;

  const advanceClip = useCallback(() => {
    setClipIndex((prev) => {
      if (prev + 1 < data.schedule.length) return prev + 1;
      return prev; // stay at end, hold timer will replay
    });
  }, [data.schedule.length]);

  const rotation = data.rotation ?? [];
  const pending = data.pending ?? [];

  return (
    <main className="flex flex-1 flex-col lg:h-screen lg:overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="chrome-text text-2xl tracking-tight font-bold">PIXELSHOP</span>
          <span className="hidden sm:inline font-mono text-[10px] tracking-[0.3em] text-cyan/80">
            THE AI SHOPPING NETWORK
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs sm:gap-4">
          <button
            onClick={() => setShowSubmit(true)}
            className="font-bold rounded-md bg-gradient-to-b from-gold to-[#b8860b] px-3 py-1.5 text-[11px] tracking-wide text-black hover:brightness-110"
          >
            + SELL
          </button>
          {currentEntry && (
            <span className="flex items-center gap-2 rounded-md bg-pink px-3 py-1.5 text-white font-bold">
              <span className="h-2 w-2 rounded-full bg-white animate-blink" />
              LIVE
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col lg:flex-row gap-4 px-4 pb-4 min-h-0">
        {/* Right: Player + Ticker */}
        <div className="flex flex-col gap-3 min-w-0 lg:order-2 lg:flex-1">
          <Player
            entry={currentEntry}
            nextEntry={nextEntry}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            onAdvance={advanceClip}
            pendingCount={pending.length}
            hasCurrent={data.schedule.length > 0}
            offline={data.offline}
            loaded={!!data.serverNow}
            now={now}
          />
          {/* Ticker */}
          {rotation.length > 0 && <Ticker rotation={rotation} pending={pending} />}
        </div>

        {/* Left: Product List */}
        <aside className="hidden lg:flex w-80 flex-col gap-3 min-h-0 lg:order-1">
          <SubmitBox offline={data.offline} onSubmitted={() => {}} />
          <ProductList
            rotation={rotation}
            pending={pending}
            schedule={data.schedule}
            now={now}
            loaded={!!data.serverNow}
            onSelect={setSelectedItem}
          />
        </aside>

        {/* Chat */}
        <ChatPanel offline={data.offline} chat={data.chat ?? []} />
      </div>

      {/* Mobile submit modal */}
      {showSubmit && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm lg:hidden"
          onClick={() => setShowSubmit(false)}
        >
          <div className="w-full max-w-md pb-4" onClick={(e) => e.stopPropagation()}>
            <SubmitBox offline={data.offline} onSubmitted={() => setShowSubmit(false)} />
          </div>
        </div>
      )}

      {/* Item detail modal */}
      {selectedItem && (
        <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </main>
  );
}

// ─── Player Component ────────────────────────────────────
//
// Single-video element with key-based switching + onEnded-driven advance.
// Inspired by the unreel project's theater pattern:
//   - Main video plays current clip, key changes on clip switch
//   - Hidden preload video buffers next clip silently
//   - onEnded drives clip advancement (not a polling clock)
//   - Hold timer: if next clip not ready, replay current (loop beats freeze)

const HOLD_MAX_MS = 4000;

function Player({
  entry,
  nextEntry,
  muted,
  onToggleMute,
  onAdvance,
  pendingCount,
  hasCurrent,
  offline,
  loaded,
  now,
}: {
  entry: ScheduleEntry | null;
  nextEntry: ScheduleEntry | null;
  muted: boolean;
  onToggleMute: () => void;
  onAdvance: () => void;
  pendingCount: number;
  hasCurrent: boolean;
  offline: boolean;
  loaded: boolean;
  now: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadRef = useRef<HTMLVideoElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entryKey = entry?.id ?? "standby";
  const videoUrl = entry?.clip?.videoUrl;
  const nextVideoUrl = nextEntry?.clip?.videoUrl;

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  // Play current clip when entry changes (key swap triggers remount)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    let cancelled = false;
    const attempt = video.play();
    if (attempt) {
      attempt.catch(() => {
        if (cancelled) return;
        video.muted = true;
        video.play().catch(() => {});
      });
    }

    return () => { cancelled = true; };
  }, [entryKey]); // eslint-disable-line

  // Keep mute state in sync
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  // Preload next clip into hidden video element
  useEffect(() => {
    const preload = preloadRef.current;
    if (!preload || !nextVideoUrl) return;
    preload.src = nextVideoUrl;
    preload.load();
  }, [nextVideoUrl]);

  // onEnded: advance to next clip via onAdvance, or replay current if none
  const onEnded = useCallback(() => {
    clearHold();
    const video = videoRef.current;
    if (!video) return;

    if (nextEntry?.clip?.videoUrl) {
      // Advance — parent increments clipIndex → key change → remount
      onAdvance();
    } else {
      // No next clip — replay current after brief hold
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        video.currentTime = 0;
        video.play().catch(() => {});
      }, HOLD_MAX_MS);
    }
  }, [nextEntry?.clip?.videoUrl, clearHold, onAdvance]);

  const toggleSound = () => {
    onToggleMute();
    const video = videoRef.current;
    if (video && video.paused) video.play().catch(() => {});
  };

  const hasVideo = entry?.clip?.videoUrl;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_60px_rgba(255,45,120,0.15)]">
      {entry && hasVideo ? (
        <>
          {/* Background blur from item image */}
          {entry.item?.image && (
            <div className="absolute inset-0">
              <Image
                src={entry.item.image}
                alt=""
                fill
                sizes="100vw"
                className="scale-110 object-cover opacity-40 blur-2xl"
              />
            </div>
          )}

          {/* Main video — key remounts on clip change */}
          <video
            key={entryKey}
            ref={videoRef}
            src={videoUrl}
            autoPlay
            playsInline
            muted={muted}
            preload="auto"
            onEnded={onEnded}
            className="absolute inset-0 h-full w-full object-contain z-10"
          />

          {/* Hidden preload video for next clip */}
          {nextVideoUrl && (
            <video
              ref={preloadRef}
              className="hidden"
              preload="auto"
              muted
              playsInline
            />
          )}

          {/* Live badge */}
          <div className="absolute left-4 top-4 z-20 flex items-center gap-2 font-mono text-[11px] tracking-widest">
            {(!entry.item?.generationDone ||
              (now - (entry.item?.newestClipAt ?? 0) < 300000)) && (
              <span className="rounded bg-pink px-2 py-1 font-bold text-white">
                ● LIVE
              </span>
            )}
          </div>

          {/* Mute toggle */}
          <div className="absolute right-4 top-4 z-20 flex gap-2">
            <button
              onClick={toggleSound}
              className="rounded-lg bg-black/60 px-3 py-1.5 font-mono text-xs text-white backdrop-blur hover:bg-black/80"
            >
              {muted ? "🔇 UNMUTE" : "🔊 MUTE"}
            </button>
          </div>

          {/* Subtitles — bound to clip, not independent timer */}
          {entry.clip?.dialogue && (
            <Subtitles dialogue={entry.clip.dialogue} />
          )}

          {/* Question badge */}
          {entry.clip?.source === "question" && entry.clip.askedBy && (
            <div className="absolute inset-x-2 bottom-[5.6rem] z-20 sm:inset-x-auto sm:left-4 sm:bottom-44 sm:max-w-md">
              <div className="rounded-lg border border-cyan/40 bg-black/70 px-3 py-2 backdrop-blur">
                <p className="font-mono text-[10px] tracking-widest text-cyan">
                  📩 VIEWER QUESTION — {entry.clip.askedBy}
                </p>
              </div>
            </div>
          )}

          {/* Item info bar */}
          <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 pt-10 sm:p-4 sm:pt-14">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {entry.item && (
                    <span className="rounded bg-gold px-1.5 py-0.5 font-mono text-[9px] font-bold text-black sm:px-2 sm:text-[11px]">
                      ITEM {entry.item.itemNumber}
                    </span>
                  )}
                  <span className="hidden sm:inline font-mono text-[11px] tracking-widest text-cyan">
                    TODAY&apos;S SPECIAL VALUE
                  </span>
                </div>
                {entry.item && (
                  <h2 className="mt-0.5 truncate text-sm text-white sm:mt-1 sm:text-2xl">
                    {entry.item.title}
                  </h2>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                {entry.item?.price && (
                  <span className="chrome-text text-lg sm:text-3xl">{entry.item.price}</span>
                )}
                {entry.item && (
                  <a
                    href={entry.item.url}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className="animate-blink rounded-lg bg-gradient-to-b from-pink to-[#c2185b] px-3 py-1.5 text-xs text-white shadow-[0_0_25px_rgba(255,45,120,0.5)] hover:brightness-110 sm:rounded-xl sm:px-5 sm:py-2.5 sm:text-base"
                  >
                    BUY NOW
                  </a>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <Standby
          loaded={loaded}
          pendingCount={pendingCount}
          hasCurrent={hasCurrent}
          offline={offline}
        />
      )}
    </div>
  );
}

// ─── Subtitles ───────────────────────────────────────────
// Bound to the current clip: shows the full dialogue line while the
// clip plays, no independent timer. Subtitle changes only when the
// clip changes (via key remount), so it never drifts from the audio.

function Subtitles({ dialogue }: { dialogue: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-[3.4rem] z-20 flex justify-center sm:inset-x-4 sm:bottom-28">
      <p className="max-w-2xl rounded bg-black/75 px-2 py-1 text-center font-mono text-[10px] leading-snug text-white sm:px-3 sm:py-1.5 sm:text-sm">
        {dialogue}
      </p>
    </div>
  );
}

// ─── Standby ─────────────────────────────────────────────

function Standby({
  loaded,
  pendingCount,
  hasCurrent,
  offline,
}: {
  loaded: boolean;
  pendingCount: number;
  hasCurrent: boolean;
  offline: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
      <div className="animate-standby flex h-24 w-full max-w-md overflow-hidden rounded-lg opacity-80">
        {["#ff2d78", "#ffd24a", "#38e8ff", "#8b5cf6", "#22c55e", "#f97316", "#e5e7eb"].map((c) => (
          <div key={c} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <p className="text-2xl tracking-widest text-white font-bold">PLEASE STAND BY</p>
      <p className="font-mono text-xs text-zinc-500 text-center px-6">
        {offline
          ? "PixelShop is currently offline — we'll be back soon."
          : loaded
          ? pendingCount > 0
            ? `${pendingCount} segment${pendingCount > 1 ? "s" : ""} in production at the AI studio…`
            : hasCurrent
            ? "The studio is rolling the next shot…"
            : "Nothing on air yet. Submit a product to start the show!"
          : "Tuning in…"}
      </p>
    </div>
  );
}

// ─── Ticker ──────────────────────────────────────────────

function Ticker({ rotation, pending }: { rotation: RotationItem[]; pending: PendingItem[] }) {
  const items = rotation.slice(0, 10).reverse().map(
    (e) => `${e.itemNumber} ${e.title.toUpperCase()}${e.price ? ` — ${e.price}` : ""}`
  );
  const base = items.length > 0
    ? items
    : ["SUBMIT YOUR PRODUCT — GO LIVE IN MINUTES"];

  if (pending.length > 0) {
    base.push(`${pending.length} NEW SEGMENT${pending.length > 1 ? "S" : ""} IN PRODUCTION`);
  }

  const text = base.map((e) => `AS SEEN ON PIXELSHOP ▸ ${e}`).join("  ★  ") + "  ★  ";

  return (
    <div className="overflow-hidden rounded-xl border border-gold/30 bg-panel/70">
      <div className="animate-ticker flex w-max whitespace-nowrap py-2 font-mono text-xs tracking-widest text-gold">
        <span className="px-4">{text}</span>
        <span className="px-4">{text}</span>
      </div>
    </div>
  );
}

// ─── Submit Box ──────────────────────────────────────────

function SubmitBox({
  offline,
  onSubmitted,
}: {
  offline: boolean;
  onSubmitted: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "working" | "ready" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [itemNumber, setItemNumber] = useState<string | null>(null);
  const [pollItemId, setPollItemId] = useState<string | null>(null);

  const submitProduct = useMutation(api.channel.submitProduct);
  const runPipeline = useAction(api.pipeline.runPipeline);
  const itemStatus = useQuery(api.channel.getItem, pollItemId ? { itemId: pollItemId as Id<"items"> } : "skip");

  // Poll item status: when it becomes ready/failed, update SubmitBox status.
  // The synchronous setStates below are intentional state transitions driven by
  // an external system (the Convex query), not cascading render bugs — the
  // rule's documented escape hatch for external-store sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!itemStatus || !pollItemId) return;
    if (itemStatus.status === "ready") {
      setStatus("ready");
      setPollItemId(null);
      // Auto-reset to idle after 5s so user can submit another product
      setTimeout(() => setStatus("idle"), 5000);
    } else if (itemStatus.status === "failed") {
      setStatus("failed");
      setError(itemStatus.error ?? "Generation failed");
      setPollItemId(null);
    }
  }, [itemStatus, pollItemId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || status === "submitting") return;
    setError(null);
    setStatus("submitting");

    try {
      const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      const result = await submitProduct({
        url: normalized,
        title: title.trim() || undefined,
        price: price.trim() || undefined,
        image: image.trim() || undefined,
      });
      setItemNumber(result.itemNumber);
      setUrl("");
      setTitle("");
      setPrice("");
      setImage("");
      setStatus("working");
      setPollItemId(result.itemId);
      onSubmitted();

      // Fire the pipeline — don't await; it runs in the background
      runPipeline({ itemId: result.itemId }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("failed");
    }
  };

  const busy = status === "submitting" || status === "working";

  return (
    <div className="rounded-2xl border border-pink/30 bg-panel/70 p-4 backdrop-blur">
      <p className="font-bold text-sm tracking-wide text-gold">PUT YOUR PRODUCT ON TV</p>
      <p className="mt-1 text-xs text-zinc-500">
        {offline ? "PixelShop is currently offline - we'll be back soon." : "Paste a product URL - our AI studio plans a full segment and airs it live."}
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="store.com/your-product"
          disabled={busy}
          className="w-full rounded-lg bg-black/30 border border-pink/30 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-pink focus:ring-2 focus:ring-pink/30 disabled:opacity-60"
        />
        {/* Optional fields for manual fallback */}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-400">Manual details (optional)</summary>
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product title"
              disabled={busy}
              className="rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-pink/50"
            />
            <input
              type="text"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price (e.g. $29.99)"
              disabled={busy}
              className="rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-pink/50"
            />
            <input
              type="text"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="Image URL"
              disabled={busy}
              className="rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-pink/50"
            />
          </div>
        </details>
        <button
          type="submit"
          disabled={busy}
          className="font-bold rounded-lg bg-gradient-to-b from-pink to-[#c2185b] px-4 py-2.5 text-sm tracking-wide text-white shadow-[0_0_20px_rgba(255,45,120,0.35)] hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? "ON IT…" : "PUT IT ON TV"}
        </button>
      </form>
      {status === "working" && itemNumber && (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-pink border-t-transparent" />
          {itemNumber} — preparing the studio…
        </p>
      )}
      {status === "ready" && itemNumber && (
        <p className="mt-3 text-xs">
          <span className="font-bold text-gold">YOU&apos;RE ON AIR! 📺</span>{" "}
          <span className="text-zinc-500">{itemNumber} just joined the rotation.</span>
        </p>
      )}
      {status === "failed" && error && (
        <p className="mt-3 text-xs text-[#ff8a8a]">
          <span className="font-semibold">Couldn&apos;t air that one: </span>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Product List ────────────────────────────────────────
// Displays CURRENT / UP NEXT / PAST PRODUCTS based on schedule timeline.
// Uses schedule entries (time-ordered) to determine which items are
// currently playing, coming up, or have already aired.

function ProductList({
  rotation,
  pending,
  schedule,
  now,
  loaded,
  onSelect,
}: {
  rotation: RotationItem[];
  pending: PendingItem[];
  schedule: ScheduleEntry[];
  now: number;
  loaded: boolean;
  onSelect: (item: RotationItem) => void;
}) {
  // Split schedule into past / current / future based on `now`
  const pastEntries: ScheduleEntry[] = [];
  let currentSchedEntry: ScheduleEntry | null = null;
  const futureEntries: ScheduleEntry[] = [];

  for (const entry of schedule) {
    const endAt = entry.startAt + entry.duration * 1000;
    if (now >= entry.startAt && now < endAt) {
      currentSchedEntry = entry;
    } else if (endAt <= now) {
      pastEntries.push(entry);
    } else if (entry.startAt > now) {
      futureEntries.push(entry);
    }
  }

  // Derive item-level lists from schedule entries
  // Current item (deduplicated by item id)
  const currentRotationItem = currentSchedEntry?.item
    ? rotation.find((r) => r.id === currentSchedEntry!.item!.id) ?? null
    : null;

  // Up next: unique item ids from future entries, excluding current
  const seenIds = new Set<string>();
  if (currentSchedEntry?.item) seenIds.add(currentSchedEntry.item.id);
  const upNextItems: RotationItem[] = [];
  for (const entry of futureEntries) {
    if (entry.item && !seenIds.has(entry.item.id)) {
      seenIds.add(entry.item.id);
      const r = rotation.find((r) => r.id === entry.item!.id);
      if (r) upNextItems.push(r);
    }
  }

  // Past products: unique item ids from past entries (most recent first)
  const pastSeenIds = new Set<string>();
  const pastItems: RotationItem[] = [];
  for (let i = pastEntries.length - 1; i >= 0; i--) {
    const entry = pastEntries[i];
    if (entry.item && !pastSeenIds.has(entry.item.id)) {
      pastSeenIds.add(entry.item.id);
      const r = rotation.find((r) => r.id === entry.item!.id);
      if (r) pastItems.push(r);
    }
  }

  return (
    <div className="flex-1 min-h-0 max-h-[calc(100vh-16rem)] overflow-y-auto rounded-2xl border border-white/10 bg-panel/60 backdrop-blur">
      <section>
        <SectionLabel label="CURRENT PRODUCT" />
        {!currentRotationItem && (
          <p className="px-4 py-6 text-center text-xs text-zinc-600">
            {loaded ? "Nothing on air yet — be the first sponsor!" : "Tuning in…"}
          </p>
        )}
        {currentRotationItem && (
          <ProductRow item={currentRotationItem} highlight onClicValue={() => onSelect(currentRotationItem)} />
        )}
      </section>

      {(upNextItems.length > 0 || pending.length > 0) && (
        <section>
          <SectionLabel label="UP NEXT" />
          {upNextItems.map((item) => (
            <ProductRow key={item.id} item={item} onClicValue={() => onSelect(item)} />
          ))}
          {pending.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <ProductImage src={item.image} alt={item.title} dim />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-400">{item.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-cyan/80">
                  <span className="inline-block h-2 w-2 shrink-0 animate-spin rounded-full border border-cyan border-t-transparent" />
                  <span className="truncate">{item.itemNumber} · in production…</span>
                </p>
              </div>
            </div>
          ))}
        </section>
      )}

      {pastItems.length > 0 && (
        <section>
          <SectionLabel label="PAST PRODUCTS" />
          {pastItems.map((item) => (
            <ProductRow key={item.id} item={item} onClicValue={() => onSelect(item)} />
          ))}
        </section>
      )}
    </div>
  );
}

function ProductRow({
  item,
  highlight,
  onClicValue,
}: {
  item: RotationItem;
  highlight?: boolean;
  onClicValue: () => void;
}) {
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return (
    <button
      type="button"
      onClick={onClicValue}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5 ${highlight ? "bg-pink/10" : ""}`}
    >
      <ProductImage src={item.image} alt={item.title} highlight={highlight} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${highlight ? "font-semibold text-white" : "text-zinc-300"}`}>
          {item.title}
        </p>
        <p className="mt-0.5 font-mono text-[10px] tracking-wider text-zinc-600">
          {highlight && <span className="font-bold text-pink">● ON AIR · </span>}
          {item.itemNumber}
          {item.playbackSeconds > 0 && <span className="text-cyan/70"> · {fmtTime(item.playbackSeconds)} aired</span>}
        </p>
      </div>
    </button>
  );
}

function ProductImage({
  src,
  alt,
  highlight,
  dim,
}: {
  src?: string;
  alt: string;
  highlight?: boolean;
  dim?: boolean;
}) {
  return src ? (
    <Image
      src={src}
      alt={alt}
      width={44}
      height={44}
      className={`h-11 w-11 shrink-0 rounded-lg border object-cover ${highlight ? "border-pink shadow-[0_0_12px_rgba(255,45,120,0.5)]" : "border-white/10"} ${dim ? "opacity-60" : ""}`}
    />
  ) : (
    <div className="h-11 w-11 shrink-0 rounded-lg border border-white/10 bg-gradient-to-br from-pink/30 to-cyan/20" />
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 border-b border-white/10 bg-panel/95 px-4 py-2 font-mono text-[10px] tracking-[0.25em] text-zinc-500 backdrop-blur">
      {label}
    </div>
  );
}

// ─── Item Modal ──────────────────────────────────────────

function ItemModal({ item, onClose }: { item: RotationItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-panel p-5 shadow-[0_0_60px_rgba(255,45,120,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="rounded bg-gold px-2 py-0.5 font-mono text-[11px] font-bold text-black">
            ITEM {item.itemNumber}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-xs text-zinc-400 hover:bg-white/20"
          >
            ✕
          </button>
        </div>
        {item.image && (
          <Image
            src={item.image}
            alt={item.title}
            width={800}
            height={200}
            className="mt-4 h-48 w-full rounded-xl border border-white/10 object-cover"
          />
        )}
        <h3 className="mt-4 text-xl text-white font-bold">{item.title}</h3>
        {item.price && <p className="chrome-text mt-1 text-3xl">{item.price}</p>}
        <a
          href={item.url}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className="mt-5 block rounded-xl bg-gradient-to-b from-pink to-[#c2185b] px-5 py-3 text-center text-white shadow-[0_0_25px_rgba(255,45,120,0.5)] hover:brightness-110"
        >
          VISIT PRODUCT PAGE →
        </a>
        <p className="mt-3 text-center text-[10px] text-zinc-600">
          Links open the seller&apos;s site in a new tab.
        </p>
      </div>
    </div>
  );
}

// ─── Chat Panel ──────────────────────────────────────────

function ChatPanel({ offline, chat }: { offline: boolean; chat: ChatMessage[] }) {
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [lastMsg, setLastMsg] = useState<string | null>(null);
  const sendChat = useMutation(api.channel.sendChat);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the chat identity once on mount. Reading localStorage is an external-
  // system sync that must happen in an effect (a lazy useState initializer would
  // mismatch the prerendered HTML), so the sync setState is intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pixelshop-name");
      if (saved) {
        setName(saved);
      } else {
        const random = `Shopper${Math.floor(1000 + Math.random() * 9000)}`;
        setName(random);
        localStorage.setItem("pixelshop-name", random);
      }
    } catch {
      const random = `Shopper${Math.floor(1000 + Math.random() * 9000)}`;
      setName(random);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-scroll
  const lastId = chat.length ? chat[chat.length - 1].id : "";
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [lastId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !name.trim()) return;
    setInput("");
    setLastMsg(text);
    try {
      await sendChat({ sender: name.trim(), text });
    } catch {}
  };

  return (
    <aside className="flex w-full lg:w-80 flex-col rounded-2xl border border-white/10 bg-panel/60 backdrop-blur h-96 max-h-[45vh] lg:h-auto lg:max-h-none lg:order-3 min-h-0">
      <div className="border-b border-white/10 px-4 py-3 font-mono text-xs tracking-widest text-zinc-500">
        LIVE CHAT
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
        {chat.length === 0 && (
          <p className="text-xs text-zinc-600">
            Ask the host a question live — they answer on air!
          </p>
        )}
        {chat.map((msg) =>
          msg.role === "host" ? (
            <p key={msg.id} className="rounded-md border border-gold/25 bg-gold/10 px-2 py-1.5 leading-snug break-words">
              <span className="font-semibold text-gold">🎙 {msg.user}</span>{" "}
              <span className="text-zinc-300">{msg.text}</span>
            </p>
          ) : (
            <p key={msg.id} className="leading-snug break-words">
              <span className="font-semibold" style={{ color: userColor(msg.user) }}>
                {msg.user}
              </span>{" "}
              <span className="text-zinc-300">{msg.text}</span>
            </p>
          )
        )}
        {lastMsg && (
          <p className="flex items-center gap-2 leading-snug break-words opacity-50">
            <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-pink border-t-transparent" />
            <span className="text-zinc-400">{lastMsg}</span>
          </p>
        )}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] text-zinc-600">
          <span>CHATTING AS</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { try { localStorage.setItem("pixelshop-name", name); } catch {} }}
            maxLength={24}
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-semibold outline-none focus:bg-black/30"
            style={{ color: userColor(name || "Shopper") }}
          />
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={280}
            disabled={offline}
            placeholder={offline ? "Chat is paused — back soon!" : "Ask the host a question…"}
            className="min-w-0 flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs outline-none placeholder:text-zinc-600 focus:border-pink/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={offline || !input.trim()}
            className="rounded-lg bg-pink/90 px-3 py-2 text-xs font-bold text-white hover:bg-pink disabled:opacity-40"
          >
            SEND
          </button>
        </form>
      </div>
    </aside>
  );
}
