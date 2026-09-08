# ─── Stage 1: build the Next.js static export ─────────────────────────
FROM oven/bun:1.3.11 AS build

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build. NEXT_PUBLIC_CONVEX_URL is baked into the bundle and
# must be reachable from the browser (default: autodetected at build time via
# scripts/lan-ip.mjs; pass --build-arg to override).
COPY . .
ARG NEXT_PUBLIC_CONVEX_URL=""
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CONVEX_SITE_URL=""
ENV NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL
# Keep heap usage bounded so the build fits on small / CI hosts.
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN bun run build

# ─── Stage 2: serve the static site from nginx ─────────────────────────
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
