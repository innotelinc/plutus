#!/bin/bash
# ─── Plutus one-command setup ──────────────────────────────────────────────────
#
# Copies .env.example to .env (if not present), installs dependencies,
# and prints next steps.
#
# Usage:
#   ./setup.sh
#
# After running:
#   1. Edit .env with your admin key: CONVEX_SELF_HOSTED_ADMIN_KEY=...
#   2. Run: ./scripts/get-admin-key.sh  (or set the key manually)
#   3. Run: make push    (pushes functions + seeds demo data)
#   4. Run: make build   (builds static export)
#   5. Run: docker compose up -d    (starts the stack)

set -e

echo "→ Plutus setup"

# Copy .env.example to .env if .env doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  Created .env from .env.example"
    echo "  → Edit .env with your CONVEX_SELF_HOSTED_ADMIN_KEY"
else
    echo "  .env already exists, skipping copy"
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d node_modules ]; then
    echo "→ Installing dependencies..."
    npm install
    echo "  Dependencies installed"
else
    echo "  node_modules already exists, skipping install"
fi

echo ""
echo "→ Next steps:"
echo "   1. Edit .env: set CONVEX_SELF_HOSTED_ADMIN_KEY"
echo "   2. Run: ./scripts/get-admin-key.sh  (or set key manually)"
echo "   3. Run: make push"
echo "   4. Run: make build"
echo "   5. Run: docker compose up -d"
echo ""
echo "→ Or run the full stack:"
echo "   docker compose up -d"
