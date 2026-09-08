#!/bin/bash
# ─── Push functions + seed demo data ───────────────────────────────────────────
#
# The self-hosted Convex backend's generate_key binary is non-deterministic,
# so the admin key changes on every call. This script generates a fresh key
# and immediately pushes+seeds while the key is still valid.
#
# Usage:
#   ./scripts/push-and-seed.sh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "→ Generating fresh admin key and pushing functions..."

# Host address: PLUTUS_HOST env, else autodetected LAN IP, else 127.0.0.1.
HOST_ADDR="${PLUTUS_HOST:-$(node scripts/lan-ip.mjs 2>/dev/null || echo 127.0.0.1)}"

ADMIN_KEY=$(docker compose exec -T backend bash -c 'source ./read_credentials.sh && bash /convex/generate_admin_key.sh' 2>/dev/null | tr -d '[:space:]')

if [ -z "$ADMIN_KEY" ]; then
  echo "✗ Could not generate admin key. Is the backend running?"
  echo "  Try: docker compose up -d backend"
  exit 1
fi

echo "  Admin key: $ADMIN_KEY"

# Update .env.local with the fresh key
if grep -q '^CONVEX_SELF_HOSTED_ADMIN_KEY=' .env.local 2>/dev/null; then
  sed -i "s/^CONVEX_SELF_HOSTED_ADMIN_KEY=.*/CONVEX_SELF_HOSTED_ADMIN_KEY=$ADMIN_KEY/" .env.local
else
  echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$ADMIN_KEY" >> .env.local
fi

export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://${HOST_ADDR}:3210}"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"

echo "→ Pushing Convex functions..."
npx convex dev --once 2>&1 | tail -3

echo "→ Seeding demo data..."
npm run db:seed 2>&1 | tail -3

echo ""
echo "→ Done. Key was valid for this push+seed cycle."
echo "   For subsequent pushes, re-run this script."
