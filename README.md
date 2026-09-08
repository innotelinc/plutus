# 🛒 PLUTUS — Shop. Watch. Discover.

**Self-hosted AI shopping channel: submit a product URL and watch an AI host present it in generated video clips — fully open-source, no external video APIs required.**

[![CI](https://github.com/innotelinc/plutus/actions/workflows/ci.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/ci.yml)
[![Conformity](https://github.com/innotelinc/plutus/actions/workflows/conform.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/conform.yml)
[![Release](https://github.com/innotelinc/plutus/actions/workflows/release.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/release.yml)
[![Pages](https://github.com/innotelinc/plutus/actions/workflows/pages.yml/badge.svg)](https://github.com/innotelinc/plutus/actions/workflows/pages.yml)

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

## Services

Primary domain: `plutus.innotel.us` (configure in `.env`)

| Service | URL | Backed by |
|---------|-----|-----------|
| Web UI | `http://192.168.1.10:3000` | Next.js static export (Nginx) |
| Convex backend | `http://192.168.1.10:3210` | Self-hosted Convex |
| Convex site proxy | `http://192.168.1.10:3211` | Convex HTTP actions |
| Dashboard | `http://192.168.1.10:6791` | Convex dashboard |
| OmniRoute (AI gateway) | `http://192.168.1.10:20128` | OmniRoute container |

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
cp .env.example .env        # edit: CONVEX_SELF_HOSTED_ADMIN_KEY
./scripts/get-admin-key.sh  # auto-fetch admin key from backend
make push                   # push functions + seed demo data
make build                  # build static export
docker compose up -d        # start the stack
```

`setup.sh` is idempotent: safe to re-run; it copies `.env.example` if needed
and installs dependencies.

### AI keys

The pipeline uses OmniRoute for scripting and image generation. Configure via
environment variables:

```bash
# OmniRoute gateway URL (default: http://localhost:20128/v1)
OMNIROUTE_BASE_URL=http://192.168.1.10:20128/v1

# Model for scripting (default: "auto" — OmniRoute picks best provider)
OMNIROUTE_MODEL=auto

# Model for image generation / keyframes (default: "auto")
OMNIROUTE_IMAGE_MODEL=auto

# Optional API key if your OmniRoute instance requires one
OMNIROUTE_API_KEY=''
```

Connect a provider in the OmniRoute dashboard (`http://192.168.1.10:20128`)
to enable scripting and image generation.

### Video pipeline

The pipeline generates 3 keyframes per clip via an image model through OmniRoute,
then uses ffmpeg's `minterpolate` filter to produce smooth motion between them.
When image generation fails, the fallback action generates 3 procedural keyframes
and animates them with ffmpeg (same approach, no external API needed).

## Status

**Phase: v0.1 — self-hosted demo.** The stack boots, the playback test passes
(5 title transitions, no errors, live badge), and submissions trigger the
pipeline. Video generation requires an OmniRoute image model to be connected.

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
docker-compose.prod.yml  Production overlay
docker-compose.agents.yml OmniRoute agent stack
scripts/         Utility scripts
  browser-check.mjs    Headless browser verification (play + submit tests)
  get-admin-key.sh     Auto-fetch admin key from backend
  push-and-seed.sh     Generate key + push + seed in one shot
src/             Next.js frontend
  app/           App router pages
  components/    React components
LICENSE          AGPL-3.0-or-later
Makefile         Convenience targets
setup.sh         One-command setup
```

## License

PLUTUS is licensed under **AGPL-3.0-or-later** — see [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `make test` to verify
5. Submit a pull request

## Documentation

- [Convex self-hosted guide](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
- [ffmpeg minterpolate docs](https://ffmpeg.org/ffmpeg-filters.html#minterpolate)
