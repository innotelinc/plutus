---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: 'b74bcafc-2825-45e9-9afe-c09421825672'
  PropagateID: 'b74bcafc-2825-45e9-9afe-c09421825672'
  ReservedCode1: 'fa320fef-380c-44a6-bb58-0224055817cf'
  ReservedCode2: 'fa320fef-380c-44a6-bb58-0224055817cf'
---

# Hackathon log

- **Project:** pixelshop
- **Event:** Convex All Gas Hackathon
- **What it does:** AI-generated live shopping channel where users submit product URLs and watch AI-hosted video segments air in real time.
- **Live app:** https://fearless-otter-334.convex.site
- **Repo:** https://github.com/hhwjsw711/pixelshop (private)
- **Frontend:** Convex static hosting (live)
- **Convex deployment:** dev:fearless-otter-334 (https://fearless-otter-334.convex.cloud)
- **Components:** @convex-dev/static-hosting
- **Convex features:** database, real-time subscriptions, static hosting, cron jobs
- **Auth:** admin secret (clearMockData only)
- **AI models:** fal H3 Max Turbo (text-to-video), OpenAI GPT-4o-mini (scriptwriting)
- **Started:** 2026-09-03T22:12:32Z
- **Last updated:** 2026-09-04T00:10:00Z

## Log

### 2026-09-03 - working tree
Project initialized from scratch for the Convex All Gas Hackathon. Created the
project directory at E:\Workspace\pixelshop. Installed the Convex agent skills
(33 skills) globally via `npx skills add get-convex/agent-skills`. Verified the
Convex MCP server is configured in the TeleAgent opencode.json (stdio transport,
command `npx -y convex@latest mcp start`, enabled). Installed the
convex-hackathon-skill locally at `.agents/skills/convex-hackathon-skill/` with
SKILL.md and references/log-format.md. Frontend hosting decision: Convex static
hosting (convex.site). Design document drafted at `.temp/pixelshop-clone-design.md`
defining a Next.js + Convex + Tailwind + fal H3 pipeline for AI live shopping.

> AI生成

### 2026-09-03 - P0 skeleton complete
P0 milestone reached. Next.js 16 + React 19 + Convex 1.45 + Tailwind v4 initialized.
Convex schema with 5 tables (channels, items, clips, schedule, chat) and indexes
deployed to cloud (dev:fearless-otter-334). Backend functions: ensureChannel,
getChannel, submitProduct, sendChat, getItem. Frontend UI with live player
(dual-video buffer), submit box, product list, chat panel, subtitles, standby
screen, ticker, and item detail modal. TypeScript typecheck passes (0 errors).
Next.js build succeeds. GitHub repo created (private) and code pushed.
P0 acceptance test: submitted a test product via `convex run channel:submitProduct`
— item PX-1001 created with correct title/price/image, channel shows it in pending
list, status queued. All data verified via getItem and getChannel queries.

> AI生成

### 2026-09-03 - P1 playback core complete
P1 milestone reached. Dual-video buffer player rewritten with canvas transition
frames: video A plays current clip while video B preloads next; on switch, canvas
captures last frame from old video, new video fades in over it. 250ms clock tick
with serverNow skew alignment keeps schedule entries synced. Added seedMockData /
clearMockData mutations for testing with 3 public sample MP4s (test-videos.co.uk).
Verified in browser: BigBuckBunny 720p plays → seamless switch to Jellyfish 720p
(no black screen, no transition artifact) → third clip (Bunny 360p) preloaded.
Subtitles, LIVE badge, product info, BUY NOW all update correctly per clip.
TypeScript typecheck passes. Next.js build succeeds. Deployed to Convex cloud.

> AI生成

### 2026-09-03 - P2 generation pipeline complete
P2 milestone reached. Full AI generation pipeline: user submits product URL →
cheerio scrapes title/price/image → OpenAI GPT-4o-mini writes 3 clip scripts
(intro → features → call-to-action) → fal H3 Max Turbo generates 10s 720p videos
→ clips auto-scheduled and aired live. Convex action `runPipeline` orchestrates
the full flow with mutations for each step (updateItemDetails, markItemWorking,
addClipToSchedule, finalizeItem, failItem). Added same-origin media proxy
(/api/media) for fal CDN videos (canvas CORS). SubmitBox polls item status
and auto-recovers when generation completes. Schedule startAt ensures clips
never schedule in the past. Fixes: OpenAI SDK replaced with fetch (Convex
action incompatibility), Amazon title cleanup, price scraping filter.

P2 acceptance test: submitted apple.com/apple-vision-pro → LIVE in ~15s with
AI subtitle "Introducing the revolutionary Apple Vision Pro..." → clip 2
seamless: "your Apple Vision Pro today for just $3499!" → clip 3 aired →
standby. 3 clips, 30s total, zero console errors.

> AI生成

### 2026-09-03 - P2.5 rotation loop + three-state UI
P2.5 milestone reached. Cron-based rotation loop: rotateSchedule runs every 1
minute, promoting pending items to scheduled status and cycling the schedule.
Three-state product list: CURRENT (live now), UP NEXT (queued), PAST PRODUCTS
(aired). Schedule entries use startAt timestamps with serverNow skew alignment.
First clip auto-plays on page load. Standby screen shown when no clips scheduled.
TypeScript typecheck passes. Next.js build succeeds. Deployed to Convex cloud.

> AI生成

### 2026-09-03 - player rearchitect
Player rewritten from dual-video canvas buffer to single <video> + onEnded
drive. Proxy media route (/api/media) added to stream fal CDN videos through
same origin, eliminating canvas CORS issues. Subtitles bound to clip via React
key remount. Hold timer replays last clip when no next clip is available.
This simplified the player from ~300 lines to ~150 and removed the 250ms clock
tick entirely.

> AI生成

### 2026-09-03 - adversarial audit + fixes
Two-round adversarial code audit completed. Round 1 identified 8 severe + 7
high-priority issues. Round 2 corrected round 1 misdiagnoses (rotateSchedule
"race condition" was wrong — Convex mutations are serialized) and found missed
player clock/onEnded race. 15 fixes applied across 8 files (+251 / -123 lines):

- S1: Rate limiting on submitProduct (max 5 queued/working per 10 min) + admin
  secret required for clearMockData
- S2: SSRF protection — backend URL validation + private IP rejection on
  scrapeProduct
- S3: Action stale-read prevention — addClipToSchedule mutation re-reads last
  schedule end to prevent overlap
- S4: Player switched from 250ms clock to onEnded event-driven clip switching
- H1: recoverStuckItems cron every 5 min for items stuck in working > 5 min
- H3: Removed SEED DEMO / CLEAR buttons from UI
- H4: Clip generation 2x retry with 500ms backoff, pollInterval 500ms → 1000ms
- H5: Media proxy 30s timeout + force-cache
- H6: Removed dead code (standbyMsg, needsTap, undefined question field)
- H7: Removed unused openai dependency
- M1: itemNumber uses max(existing) + 1 instead of length + 1
- M10: Fixed schema.ts comment encoding garble

TypeScript typecheck passes. Deployed to Convex cloud. Pushed to GitHub
(commit e2ae6ee).

> AI生成

### 2026-09-04 - Convex static hosting deployment
Frontend deployed via @convex-dev/static-hosting. Component mounted at root
path (/), Convex backend functions under /api. Next.js configured with
output: "export" for static HTML generation. Removed /api/media proxy route
(incompatible with static export — no server runtime). Pipeline now stores raw
fal CDN URLs directly since player uses pure <video> + onEnded (no canvas CORS).
Uploaded 37 static files (HTML + JS chunks + CSS + fonts). App live at
https://fearless-otter-334.convex.site. Verified: HTTP 200, all assets load,
PixelShop UI renders, Convex client connects to backend.

> AI生成

### 2026-09-04 - self-hosted open-source stack migration
Rebuilt the AI stack off the closed providers. Convex cloud + static hosting
replaced by self-hosted Convex (docker compose: ghcr.io/get-convex/convex-backend
+ dashboard; frontend served as static export from nginx). Video generation
switched from fal.ai to the Open Generative AI flow (MuAPI submit+poll,
minimax-h3-open-text-to-video @ 768p) — fal key is no longer required up front;
if MUAPI_API_KEY is missing the pipeline scripts the segment then fails the item
with an actionable message. Product scripting switched from OpenAI GPT to the
OpenClaw/OpenClaude stack routed through OmniRoute: the pipeline POSTs to
OmniRoute's OpenAI-compatible endpoint (default http://localhost:20128/v1,
model "auto"), and OpenClaude + OpenClaw point at the same gateway.
recoverStuckItems threshold raised to 15 min (H3 renders slower than fal turbo).
Removed @fal-ai/client, @convex-dev/static-hosting, and convex.config.ts
static-hosting wiring. Verified end-to-end against a live self-hosted backend:
codegen, schema + functions push, seedMockData, getChannel reads, tsc clean for
convex + root, next static export, nginx serving HTTP 200 with the Convex URL
baked in.

> AI生成