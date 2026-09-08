# PixelShop — Live AI Shopping Network

AI-powered live shopping: submit a product URL, and an AI "studio" scripts a
hosted segment, renders H3 video clips, and airs them on a live channel with
subtitles, ticker, and live chat.

## Tech Stack

| Concern              | Technology                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Frontend             | **Next.js 16** (App Router, static export) + **React 19** + Tailwind CSS v4                            |
| Database / backend   | **Convex, self-hosted** ([convex-backend](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)) — DB, real-time subscriptions, cron jobs |
| H3 video generation  | **Open Generative AI** ([open-generative-ai](https://github.com/anil-matcha/open-generative-ai)) MiniMax H3 flow (MuAPI client, `minimax-h3-open-text-to-video`). When MuAPI is unavailable, the pipeline generates fallback clips locally with ffmpeg. |
| Product scripting    | **OpenClaw** ([openclaw](https://github.com/openclaw/openclaw)) using **OpenClaude** ([openclaude](https://github.com/Gitlawb/openclaude)), integrated through **OmniRoute** ([OmniRoute](https://github.com/diegosouzapw/OmniRoute), the OpenAI-compatible gateway) |

This replaces the original hackathon stack (Convex *cloud* + fal.ai + OpenAI GPT).

### How the AI services fit together

```
                     ┌────────────────────────────────────────────────┐
  Browser ─────────▶ │ web (nginx, static Next.js export)             │
                     └───────────────────────┬────────────────────────┘
                                             │ Convex sync (port 3210)
                     ┌───────────────────────▼────────────────────────┐
                     │ convex backend + dashboard (docker compose)    │
                     │   • channel/player state, schedule, chat       │
                     │   • runPipeline action (convex/pipeline.ts)    │
                     └───────┬───────────────────────────┬────────────┘
                             │ (1) product scripts        │ (2) H3 clips
                     ┌───────▼────────────┐      ┌────────▼─────────────┐
                     │ OmniRoute gateway  │      │ MuAPI                │
                     │ :20128/v1          │      │ api.muapi.ai         │
                     │ (OpenAI-compatible)│      │ (what open-generative│
                     └───────┬────────────┘      │  -ai speaks)         │
                             │                    └────────┬─────────────┘
              ┌──────────────┼──────────────┐              │
              ▼              ▼              ▼              ▼
      OpenClaude CLI   OpenClaw gateway   any provider  MiniMax H3
      (script authoring)(assistant host)  you connect   (768p video)

                     (3) fallback clips (when MuAPI is unavailable)
                     ┌────────────────────────────────────────────────┐
                     │ backend container                               │
                     │   • ffmpeg + PNG frame generation               │
                     │   • clips served via nginx /fallback-clips/     │
                     └────────────────────────────────────────────────┘
```

- **Product scripting** — `convex/pipeline.ts` POSTs the product + a prompt to
  OmniRoute's OpenAI-compatible `/v1/chat/completions` endpoint. OmniRoute
  routes the request to whichever provider you connected in its dashboard.
  OpenClaude (agent CLI) and OpenClaw (assistant gateway) are configured
  against that *same* endpoint, so scripts written by the pipeline and scripts
  authored interactively come from identical models.
- **H3 video generation** — Open Generative AI is a UI client of MuAPI; this
  pipeline reuses its exact submit-and-poll flow (`/api/v1/{model}` →
  `/api/v1/predictions/{id}/result`) with the MiniMax H3 model from its
  catalog (`minimax-h3-open-text-to-video`, 768p / 16:9 / 10s).

## Getting Started (self-hosted)

Prereqs: Docker, and [bun](https://bun.sh) (or npm) + Node 20+.

### 1. Start the Convex backend + dashboard

```bash
docker compose up -d backend dashboard
docker compose exec backend ./generate_admin_key.sh   # copy the admin key
```

The backend listens on `http://127.0.0.1:3210` (sync + mutations)
and `http://127.0.0.1:3211` (HTTP actions / file proxy); the dashboard is at
`http://localhost:6791`.

### 2. Configure the project

```bash
cp .env.example .env.local
# edit .env.local: set CONVEX_SELF_HOSTED_ADMIN_KEY to the key from step 1
```

### 3. Install, push the backend, run the site

```bash
bun install
bun run convex:dev          # pushes functions/crons to the self-hosted backend
bun run db:seed             # optional: airs 3 sample clips so there's something on TV
bun run dev                 # frontend on http://localhost:3000
```

Or run the whole stack (backend + dashboard + nginx web on :3000) with:

```bash
bun run build                # produce out/ (static export)
docker compose up -d
```

> The `web` service serves the host-built `out/` directory from nginx (Next.js
> has no server runtime in this project). For a fully containerized build
> (e.g. CI), use `deploy/web.Dockerfile` instead.
>
> Local dev talks to the backend at `http://127.0.0.1:3210` (the default in
> `src/components/ConvexClientProvider.tsx`). Point `NEXT_PUBLIC_CONVEX_URL`
> elsewhere if your backend is remote.
>
> **Accessing from other machines:** the frontend bakes the backend URL into the
> static bundle at build time. To access the site from other machines on your LAN,
> set `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` to the server's
> IP when building, then rebuild and restart the web container:
> ```bash
> NEXT_PUBLIC_CONVEX_URL=http://192.168.1.10:3210 \
> NEXT_PUBLIC_CONVEX_SITE_URL=http://192.168.1.10:3211 \
>   bun run build
> docker compose restart web
> ```
> Edit `.env` to make this the default for your deployment.

## Verifying the demo in a real browser

`scripts/browser-check.mjs` drives a headless Chromium over the DevTools
protocol (no dependencies) and asserts the site actually works:

```bash
bun run verify:demo     # demo clips play end-to-end (titles change, video advances)
bun run verify:submit <product-url>   # submit a product and watch the pipeline
```

It needs a `chrome-headless-shell` binary (set `CHROME_PATH` if yours is not
the default Playwright cache path) and the stack running on
`http://127.0.0.1:3000` (override with `PIXELSHOP_URL`). Exits non-zero on
failure, so it can run in CI.

## AI keys (optional but recommended)

Without any keys the site still works: product scripts fall back to canned
clips, and demo content is one command away (`bun run db:seed`).

- **MUAPI_API_KEY** — enables real H3 video generation via the Open Generative
  AI flow. Set it as a Convex env var once the backend is running:
  `npx convex env set MUAPI_API_KEY <key>`. Without it, items are scripted and
  then fail with a friendly "set MUAPI_API_KEY" message.
- **OmniRoute** — start the gateway (`docker compose -f
  docker-compose.agents.yml up -d`), open `http://localhost:20128`, and
  connect a provider (Claude, OpenAI, free tiers, local models…). Then set
  `OMNIROUTE_BASE_URL` / `OMNIROUTE_MODEL` in `.env.local` for the pipeline.
  While OmniRoute is offline, scripting gracefully falls back to canned clips.
> The pipeline action runs inside the Convex backend container, so when that
> backend is containerized (`docker compose up -d backend`), point it at the
> host gateway (the compose backend exposes `host.docker.internal` for this):
>
> ```bash
> npx convex env set OMNIROUTE_BASE_URL http://host.docker.internal:20128/v1
> ```
>
> All AI keys are set the same way (per-deployment Convex env vars, which the
> self-hosted backend injects into functions): `npx convex env set MUAPI_API_KEY
> <key>`, `npx convex env set OMNIROUTE_MODEL auto`, etc.
>


## Authoring scripts with OpenClaude / OpenClaw

The scripting stack is operator tooling that talks to the same OmniRoute
gateway the pipeline uses:

```bash
# OmniRoute → OpenClaude (agent CLI for writing/editing segment scripts)
export OPENAI_BASE_URL=http://localhost:20128/v1
export OPENAI_MODEL=auto          # or claude-sonnet-4-5, openai/gpt-4o-mini, ...
npx -y @gitlawb/openclaude

# OpenClaw (assistant gateway) — add OmniRoute as a model provider under
# Settings → Models in the Control UI, or configure it in the gateway config.
openclaw gateway status
```

## Environment variables

See [`.env.example`](.env.example) for the full annotated list:
`CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`,
`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`,
`MUAPI_API_KEY`, `MUAPI_BASE_URL`,
`OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL`, `ADMIN_SECRET`.

### Fallback clips

When MuAPI is unavailable or the key is invalid, the pipeline generates short
fallback video clips locally using ffmpeg + procedurally-generated PNG frames.
These are written to a shared Docker volume (`fallback-clips`) and served by
nginx at `/fallback-clips/<id>.mp4`. The volume is mounted into both the
backend (write) and web (read) containers. No additional setup is required —
ffmpeg-static and gif-encoder-2 are installed in the backend container by the
pipeline's initialization.

If you run the backend outside of docker compose (e.g. bare metal), install
ffmpeg-static globally in the backend environment:
```bash
npm install -g ffmpeg-static
```

## How it works

1. A viewer submits a product URL (SSRF-checked + rate-limited server side).
2. The `runPipeline` Convex action scrapes title/price/image with cheerio.
3. It asks OmniRoute for a 3-clip script (intro → features → call-to-action).
4. Each clip is rendered as H3 video through the MuAPI/open-generative-ai flow
   and inserted into the channel schedule with real timestamps.
5. The frontend subscribes to the channel in real time: a `<video>` player
   switches clips on `ended`, shows subtitles + product info, and a cron keeps
   the rotation airing.

## Layout

```
convex/            backend functions (schema, channel, pipeline, crons,
                   fallbackAction)
src/app/           Next.js App Router frontend
deploy/            web Dockerfile + nginx config + deploy README
docker-compose.yml            convex backend + dashboard + web
docker-compose.agents.yml     OmniRoute gateway (scripting)
.env               default env vars (edit for your network)
.env.example       annotated template for .env.local
```
# plutus
