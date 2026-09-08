# PLUTUS in the Innotel Platform Stack

**Role: VideoOps — self-hosted AI shopping channel that generates product videos.**

PLUTUS is a self-hosted AI shopping channel: viewers submit a product URL and an AI
host presents it in generated video clips. It assembles a Next.js frontend, a self-hosted
Convex backend, and OmniRoute for scriptwriting + keyframe generation. ffmpeg (in the
backend container) handles motion interpolation between keyframes. No external video APIs.

## Boundaries

**Owns:**
- The PLUTUS product experience — video generation pipeline, channel UI, product submission flow
- Convex backend functions (channel logic, video pipeline state)
- Next.js static export serving the frontend
- ffmpeg-based motion interpolation (in-container)

**Consumes:**
- **OmniRoute** — AI gateway for scriptwriting (`chat/completions`) and keyframe generation
  (`images/generations`). Reachable at `OMNIROUTE_BASE_URL` (default: the OmniRoute host).
- **Cerulean** — identity (Authentik SSO), DNS, and TLS for `plutus.innotel.us`. PLUTUS
  does not manage its own certificates or DNS records.
- **NPM Edge** — public routing/TLS for `plutus.innotel.us` (operated by Cerulean).

**Does not own:**
- Identity / SSO — that's Cerulean's Authentik. PLUTUS uses it if SSO is configured.
- Secrets — Infisical is the canonical store; `.env` is derived/local-only.
- Billing — not in scope for PLUTUS currently.

## Service map

| Component | Technology | Job |
|---|---|---|
| Web UI | Next.js (static export, Nginx) | Product browsing + video playback |
| Backend | Self-hosted Convex (custom image with ffmpeg) | Channel logic, video pipeline, database |
| Dashboard | Convex dashboard | Operational visibility into the backend |
| AI gateway | OmniRoute | Scriptwriting + keyframe generation |
| Video gen | ffmpeg `minterpolate` | Motion interpolation between T2I keyframes |
| Reverse proxy | Nginx (deploy/nginx.conf) | Serve static export + proxy fallback clips |

## In the ecosystem

- **Identity:** Cerulean Authentik (optional SSO).
- **Secrets:** Infisical (SecretOps); `.env` is derived/local-only.
- **Trust:** Cerulean DNS + TLS — `plutus.innotel.us` is a Cerulean-managed host.
- **Edge:** NPM Edge serves the public host; Cerulean provisions the proxy host and attaches
  the `*.plutus.innotel.us` wildcard cert.
- **AI:** OmniRoute fronts all AI providers — PLUTUS never stores vendor keys.

PLUTUS links back to the canonical stack: <https://github.com/innotelinc/innotel-platform-stack>
