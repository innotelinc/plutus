# 🛒 PLUTUS — Shop. Watch. Discover.

**Self-hosted AI shopping channel (VideoOps): submit a product URL and watch an AI host present it in generated video clips — fully open-source, no external video APIs required.**

[![CI](https://github.com/innotelinc/plutus/actions/workflows/ci.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/ci.yml)
[![Conformity](https://github.com/innotelinc/plutus/actions/workflows/conform.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/conform.yml)
[![Release](https://github.com/innotelinc/plutus/actions/workflows/release.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/release.yml)
[![Pages](https://github.com/innotelinc/plutus/actions/workflows/pages.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/pages.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

</div>

---

## Why PLUTUS

| Problem | PLUTUS answer |
| --- | --- |
| AI video APIs are expensive and closed | Fully open-source: T2I keyframes + ffmpeg minterpolate, no external video API |
| Shopping channels require production studios | AI-generated video clips from a product URL alone |
| Each service has its own AI integration | OmniRoute fronts 350+ providers for scripting, image gen, and more |

> **About PLUTUS** — a self-hosted AI shopping channel where viewers submit product
> URLs and an AI host presents them in generated video clips. OmniRoute handles
> scriptwriting and keyframe generation; ffmpeg animates between keyframes. No
> external video APIs, no vendor lock-in, no cloud account required.
>
> **Landing page:** [innotelinc.github.io/plutus](https://innotelinc.github.io/plutus)
> — the static project landing is published through GitHub Pages.

---

## What it is

- A 24/7 AI shopping channel with a real-time broadcast schedule (rotation cron, standby screen, live ticker, chat)
- A URL-to-video pipeline: scrape → script → keyframes → ffmpeg → air, with a fallback at every AI-dependent step
- A self-hosted Convex backend with a custom image that generates clips in-container via ffmpeg
- A broadcast player: event-driven clip switching, subtitles bound to clips, product cards
- A Docker Compose stack: backend, dashboard, web, optional OmniRoute AI gateway

## Services

`PLUTUS_HOST` is the host's LAN IP — autodetect it with `node scripts/lan-ip.mjs`
or set it explicitly in `.env`. Using the LAN IP lets other devices on your
network reach the stack; `127.0.0.1` works for localhost-only access.

| Service | URL | Backed by |
|---------|-----|-----------|
| Web UI | `http://$PLUTUS_HOST:3000` | Next.js static export (Nginx) |
| Convex backend | `http://$PLUTUS_HOST:3210` | Self-hosted Convex |
| Convex site proxy | `http://$PLUTUS_HOST:3211` | Convex HTTP actions |
| Dashboard | `http://$PLUTUS_HOST:6791` | Convex dashboard |
| OmniRoute (AI gateway) | `http://$PLUTUS_HOST:20128` | OmniRoute container |

All services are containerized (Docker); see `docker-compose.yml`.

## Platform stack

- **AI gateway:** OmniRoute — self-hosted OpenAI-compatible gateway fronting 350+
  providers. Used for scriptwriting (`chat/completions`) and keyframe generation
  (`images/generations`). Configure via `OMNIROUTE_*` env vars.
- **Video generation:** T2I keyframes via OmniRoute image model + ffmpeg
  `minterpolate` for motion interpolation. Fully open-source, self-hosted.
- **Reverse proxy:** Nginx serving the Next.js static export + proxying fallback
  clips. Configured via `deploy/nginx.conf`.
- **Runtime:** every service is containerized (Docker); the backend uses a custom
  image (`deploy/backend.Dockerfile`) with ffmpeg for in-container clip generation.
- **CI/CD:** GitHub Actions for lint, build, release, and GitHub Pages deployment
  of the static export. The landing page is published to
  [innotelinc.github.io/plutus](https://innotelinc.github.io/plutus).

## Key properties

- 🎬 AI-generated video clips from a product URL — no studio needed
- 🔓 Fully open-source: no external video APIs, no vendor lock-in
- 🎥 T2I keyframes + ffmpeg minterpolate — smooth motion between 3 generated frames
- 🤖 OmniRoute: 350+ AI providers for scripting and image generation
- 🐳 Docker Compose stack: backend, dashboard, web, optional OmniRoute
- 🎞️ Custom backend image with ffmpeg for in-container clip generation

## Quick start

```bash
cp .env.example .env        # edit: CONVEX_SELF_HOSTED_ADMIN_KEY, PLUTUS_HOST
node scripts/lan-ip.mjs     # print the autodetected LAN IP (PLUTUS_HOST)
./scripts/get-admin-key.sh  # auto-fetch admin key from backend
make push                   # push functions + seed demo data
make build                  # build static export (LAN IP baked in)
docker compose up -d        # start the stack
```

`setup.sh` is idempotent: safe to re-run; it copies `.env.example` if needed
and installs dependencies.

### AI keys

The pipeline uses OmniRoute for scripting and image generation. Configure via
environment variables:

```bash
# OmniRoute gateway URL (default: http://localhost:20128/v1)
OMNIROUTE_BASE_URL=http://$(node scripts/lan-ip.mjs):20128/v1

# Model for scripting (default: "auto" — OmniRoute picks best provider)
OMNIROUTE_MODEL=auto

# Model for image generation / keyframes (default: "auto")
OMNIROUTE_IMAGE_MODEL=auto

# Optional API key if your OmniRoute instance requires one
OMNIROUTE_API_KEY=''
```

Connect a provider in the OmniRoute dashboard (`http://$PLUTUS_HOST:20128`)
to enable scripting and image generation.

### Video pipeline

The pipeline generates 3 keyframes per clip via an image model through OmniRoute,
then uses ffmpeg's `minterpolate` filter to produce smooth motion between them.
When image generation fails, the fallback action generates 3 procedural keyframes
and animates them with ffmpeg (same approach, no external API needed).

## Status

**Phase: v0.2 — studio.** The stack boots, the playback check passes, and
submissions air end-to-end (verified with the headless-browser checks: submit →
scrape → script → fallback clips → scheduled → live). AI-generated keyframes
require an OmniRoute image provider; without one the channel airs procedural
fallback clips so the screen is never dead.

## Repo layout

```
convex/          Convex functions (queries, mutations, actions)
  _generated/    Auto-generated API types (from `npx convex dev`)
  channel.ts     Channel queries + mutations
  pipeline.ts    Pipeline action (scripting + video generation)
  videoAction.ts Node.js action (keyframe gen + ffmpeg)
  schema.ts      Database schema
deploy/          Deployment config
  backend.Dockerfile  Custom Convex backend image (with ffmpeg)
  check-admin-key.sh   Admin key verification script
  nginx.conf      Nginx config (static export + fallback clips proxy)
  web.Dockerfile  Web container Dockerfile (optional)
  README.md       Deployment docs
docker-compose.yml       Main stack (backend, dashboard, web)
docker-compose.local.yml Port-offset overlay for busy shared hosts
docker-compose.prod.yml  Production overlay
docker-compose.agents.yml OmniRoute agent stack
scripts/         Utility scripts
  lan-ip.mjs           LAN IP autodetection (PLUTUS_HOST)
  browser-check.mjs    Headless browser verification (play + submit tests)
  get-admin-key.sh     Auto-fetch admin key from backend
  push-and-seed.sh     Generate key + push + seed in one shot
src/             Next.js frontend
  app/           App router pages
  components/    React components
tests/           Unit tests (bun test)
web/landing/     GitHub Pages site (home, about, README)
LICENSE          AGPL-3.0-or-later
Makefile         Operator workflow (make help)
setup.sh         One-command setup
```

## License

PLUTUS is licensed under **AGPL-3.0-or-later** — see [LICENSE](LICENSE) for the
full canonical text. It builds on the self-hosted Convex backend (Apache-2.0) and
ffmpeg (LGPL/GPL); those upstream licenses are retained by the respective projects.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `bun test` + `bun run lint` to verify
5. Submit a pull request

## Documentation

| Document | Covers |
| --- | --- |
| [docs/stack.md](docs/stack.md) | PLUTUS's role in the Innotel Platform Stack — owns / consumes boundaries |
| [deploy/README.md](deploy/README.md) | Deployment: images, nginx, volumes, environment |
| [.env.example](.env.example) | Every environment variable, with purpose notes |
| [web/landing/about.html](https://innotelinc.github.io/plutus/about.html) | What PLUTUS is, how the pipeline airs a segment |
| [Convex self-hosted guide](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md) | Upstream backend reference |
| [OmniRoute](https://github.com/diegosouzapw/OmniRoute) | AI gateway (scripting + image generation) |
| [ffmpeg minterpolate](https://ffmpeg.org/ffmpeg-filters.html#minterpolate) | Motion interpolation filter |

---

© 2026 PLUTUS — the AI Shopping Channel. Part of the [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack) · [GitHub](https://github.com/innotelinc/plutus) · [Landing](https://innotelinc.github.io/plutus/)
