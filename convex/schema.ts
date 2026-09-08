import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ========================================================================
// Schema — 5 tables per the design doc:
//   channels  — single channel for MVP
//   items     — products submitted by users
//   clips     — generated video segments
//   schedule  — time-ordered playback entries
//   chat      — live chat messages
// ========================================================================

export default defineSchema({
  // ---- Channel ----
  channels: defineTable({
    slug: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("offline"),
      v.literal("live"),
      v.literal("standby"),
    ),
    segmentSeconds: v.number(),      // default 10
    offline: v.boolean(),
    items: v.array(v.id("items")),     // ready items (rotation)
    pending: v.array(v.id("items")),   // generating items
  }).index("by_slug", ["slug"]),

  // ---- Items (products) ----
  items: defineTable({
    channelId: v.id("channels"),
    url: v.string(),
    title: v.string(),
    price: v.optional(v.string()),
    image: v.optional(v.string()),
    itemNumber: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("working"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    generationDone: v.boolean(),
    newestClipAt: v.optional(v.number()),  // ms timestamp of latest clip
    error: v.optional(v.string()),
    firstFrameUrl: v.optional(v.string()), // first frame for clip 1
    lastFrameUrl: v.optional(v.string()),  // last frame of latest clip (for continuity)
    playbackSeconds: v.optional(v.number()), // accumulated air time
  }).index("by_channel", ["channelId"])
    .index("by_status", ["channelId", "status"]),

  // ---- Clips (generated video segments) ----
  clips: defineTable({
    channelId: v.id("channels"),
    itemId: v.id("items"),
    videoUrl: v.optional(v.string()),       // set when clip is ready
    durationMs: v.number(),                   // e.g. 10000
    dialogue: v.string(),                     // subtitle text + audio prompt
    source: v.union(
      v.literal("normal"),
      v.literal("question"),
    ),
    questionId: v.optional(v.string()),
    askedBy: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("ready"),
      v.literal("playing"),
      v.literal("done"),
      v.literal("failed"),
    ),
    retryCount: v.number(),
    clipIndex: v.number(),  // 0, 1, 2... position within item
  }).index("by_item", ["itemId"])
    .index("by_channel_status", ["channelId", "status"]),

  // ---- Schedule (playback time-axis) ----
  schedule: defineTable({
    channelId: v.id("channels"),
    itemId: v.id("items"),
    clipId: v.id("clips"),
    startAt: v.number(),    // ms timestamp (server time)
    durationMs: v.number(),
  }).index("by_channel_start", ["channelId", "startAt"]),

  // ---- Chat ----
  chat: defineTable({
    channelId: v.id("channels"),
    sender: v.string(),
    text: v.string(),
    role: v.union(
      v.literal("viewer"),
      v.literal("host"),
    ),
    queueInClipId: v.optional(v.id("clips")),
  }).index("by_channel_created", ["channelId"]),
});
