# PixelShop deploy configuration

## Directory layout

```
deploy/
  nginx.conf          # nginx config for the web container (static site + fallback clips)
  web.Dockerfile      # Multi-stage Dockerfile: build Next.js → serve with nginx
```

## Quick start

```bash
# 1. Start backend + dashboard
docker compose up -d backend dashboard

# 2. Generate admin key
docker compose exec backend ./generate_admin_key.sh
# → copy the key into .env.local (CONVEX_SELF_HOSTED_ADMIN_KEY)

# 3. Install deps + push functions
bun install
bun run convex:dev

# 4. (optional) Seed demo content
bun run db:seed

# 5. Build the web frontend + start everything
bun run build
docker compose up -d
```

The web frontend is served from `http://localhost:3000` by default. The Convex
backend is at `http://localhost:3210` and the site proxy at
`http://localhost:3211`.

See the project [README](../README.md) for the full setup guide including AI key
configuration.

## Rebuilding the web container

When you change the Next.js source or the nginx config, rebuild and restart:

```bash
bun run build
docker compose restart web
```

If you change only `deploy/nginx.conf`, a config reload is enough:

```bash
docker compose exec web nginx -s reload
```

## Environment variables

The web build bakes `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CONVEX_SITE_URL` into the static bundle. Set them at build time:

```bash
NEXT_PUBLIC_CONVEX_URL=http://192.168.1.10:3210 \
NEXT_PUBLIC_CONVEX_SITE_URL=http://192.168.1.10:3211 \
  bun run build
```

Or edit `.env` (which is read by `npm run build` / `bun run build`) and rebuild.
See `.env.example` for the full variable list.

## Volumes

| Volume            | Used by          | Purpose                                      |
| ----------------- | ---------------- | -------------------------------------------- |
| `data`            | backend          | Convex database + state                      |
| `fallback-clips`  | backend + web    | fallback video clips when MuAPI is offline   |

The `fallback-clips` volume is mounted read-write in the backend (the pipeline
writes generated clips there) and read-only in the web container (nginx serves
them under `/fallback-clips/`).

## Files

### `nginx.conf`

Configures the nginx web server inside the `web` container:

- Serves the Next.js static export from `/usr/share/nginx/html`
- SPA fallback: unknown paths → `/index.html`
- Long cache TTL for hashed static assets under `/_next/static/`
- Serves fallback clips from `/fallback-clips/` (alias to the shared volume)

### `web.Dockerfile`

Multi-stage build:

1. **Build stage** (`oven/bun:1.3.11`): installs deps, builds the Next.js
   static export into `out/`. The `NEXT_PUBLIC_CONVEX_URL` build arg is baked
   into the bundle — set it to the address where your Convex backend is reachable
   from the browser.

2. **Serve stage** (`nginx:1.27-alpine`): copies the built `out/` and the
   `nginx.conf` into a minimal nginx image.

For local dev / LAN access, build with:

```bash
docker build \
  --build-arg NEXT_PUBLIC_CONVEX_URL=http://192.168.1.10:3210 \
  -t pixelshop-web \
  -f deploy/web.Dockerfile \
  .
```

Then run it with `docker run -p 3000:80 pixelshop-web` or reference it in
`docker-compose.yml` instead of the `nginx:1.27-alpine` image.
