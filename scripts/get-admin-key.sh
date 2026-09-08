#!/bin/bash
# ─── Get admin key and update .env.local ────────────────────────────────────────
#
# The backend's generate_key binary uses a random component, so the key
# changes on every call to generate_admin_key.sh. This script generates a
# fresh key, stores it in .env.local, and immediately pushes functions +
# seeds the database while the key is still valid.
#
# Usage:
#   ./scripts/get-admin-key.sh
#
# This is useful after a fresh volume wipe (which rotates the admin key).
# The key is only valid for the duration of this script's push+seed step.
# For subsequent pushes you'll need to re-run this script.

set -e

ENV_LOCAL="./.env.local"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-gliz}"

echo "→ Generating fresh admin key from backend..."

# Generate a fresh key (non-deterministic — use immediately).
ADMIN_KEY=$(docker compose exec -T backend bash -c 'source ./read_credentials.sh && bash /convex/generate_admin_key.sh' 2>/dev/null | tr -d '[:space:]')

if [ -z "$ADMIN_KEY" ]; then
  echo "✗ Could not generate admin key. Is the backend running?"
  echo "  Try: docker compose up -d backend"
  exit 1
fi

echo "  Admin key: $ADMIN_KEY"

if [ ! -f "$ENV_LOCAL" ]; then
  echo "✗ $ENV_LOCAL not found. Create it first from .env.example."
  exit 1
fi

# Update or add CONVEX_SELF_HOSTED_ADMIN_KEY in .env.local
if grep -q '^CONVEX_SELF_HOSTED_ADMIN_KEY=' "$ENV_LOCAL"; then
  sed -i "s/^CONVEX_SELF_HOSTED_ADMIN_KEY=.*/CONVEX_SELF_HOSTED_ADMIN_KEY=$ADMIN_KEY/" "$ENV_LOCAL"
  echo "  Updated $ENV_LOCAL"
else
  echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$ADMIN_KEY" >> "$ENV_LOCAL"
  echo "  Added to $ENV_LOCAL"
fi

echo ""
echo "→ Pushing functions (key must be fresh...)..."
export CONVEX_SELF_HOSTED_URL="${CONVEX_SELF_HOSTED_URL:-http://192.168.1.10:3210}"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"
npx convex dev --once 2>&1 | tail -3

echo ""
echo "→ Seeding demo data..."
npm run db:seed 2>&1 | tail -3

echo ""
echo "→ Done. Rebuild frontend with:"
echo "   NEXT_PUBLIC_CONVEX_URL=$CONVEX_SELF_HOSTED_URL \\"
echo "   NEXT_PUBLIC_CONVEX_SITE_URL=http://192.168.1.10:3211 \\"
echo "   npm run build"
