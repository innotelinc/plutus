# ─── PLUTUS self-hosted Convex backend (with ffmpeg) ─────────────────────
#
# Extends the official self-hosted backend image to add ffmpeg, which the
# fallback clip generation action needs. Based on:
#   https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md
#
# Build:
#   docker build -f deploy/backend.Dockerfile -t plutus-backend:latest .
#
# Use in docker-compose.yml by replacing the backend image line with:
#   build:
#     context: .
#     dockerfile: deploy/backend.Dockerfile
#   # image: ghcr.io/get-convex/convex-backend:latest   # <-- comment out

FROM ghcr.io/get-convex/convex-backend:latest

# Install ffmpeg (used by the fallback clip generation action to encode PNG
# frames into MP4 clips). The official image is Debian-based (bullseye).
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*
