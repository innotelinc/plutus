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
  (`images/generations`). Reachable at `OMNIROUTE_BASE_URL` (`http://192.168.1.46:20129/v1` —
  the SSO proxy in front of the gateway, whose own `20128` is not on the LAN).
- **Cerulean** — identity (Authentik SSO), DNS, and TLS for `plutus.innotel.us`. PLUTUS
  does not manage its own certificates or DNS records.
- **NPM Edge** — public routing/TLS for `plutus.innotel.us` (operated by Cerulean).

**Does not own:**
- Identity / SSO — that's Cerulean's Authentik. PLUTUS uses it if SSO is configured.
- Secrets — **Cerulean Vault** (HashiCorp Vault, KV v2, hosted by Cerulean) is
  the canonical store; `.env` is local-only, carries the resolved values, and is
  never the source of truth. Move plaintext values in with
  `scripts/vault-migrate.py` (the shared migrator every stack mirrors), and treat
  a `vault://` reference left in `.env` as a deployment error — nothing in this
  stack resolves one at runtime.
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
- **Secrets:** Cerulean Vault (SecretOps); `.env` carries `vault://` references (local-only).
- **Trust:** Cerulean DNS + TLS — `plutus.innotel.us` is a Cerulean-managed host.
- **Edge:** NPM Edge serves the public host; Cerulean provisions the proxy host and attaches
  the `*.plutus.innotel.us` wildcard cert.
- **AI:** OmniRoute fronts all AI providers — PLUTUS never stores vendor keys.

PLUTUS links back to the canonical stack: <https://github.com/innotelinc/innotel-platform-stack>
