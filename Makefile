.PHONY: all build dev push seed test clean help

# Default target
all: help

## help: Show this help message
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'

## build: Build the Next.js static export
build:
	NEXT_PUBLIC_CONVEX_URL=http://192.168.1.10:3210 \
	NEXT_PUBLIC_CONVEX_SITE_URL=http://192.168.1.10:3211 \
	npm run build

## dev: Start development server
dev:
	npm run dev

## push: Push functions to Convex backend
push:
	./scripts/push-and-seed.sh

## seed: Seed demo data to Convex
seed:
	./scripts/push-and-seed.sh

## test: Run verification tests
test:
	@echo "Running playback test..."
	timeout 120 node scripts/browser-check.mjs play http://192.168.1.10:3000
	@echo ""
	@echo "Running submit test..."
	timeout 120 node scripts/browser-check.mjs submit http://192.168.1.10:3000

## clean: Clean build artifacts
clean:
	rm -rf out/.next node_modules/.cache

## setup: One-command setup (copy .env.example, install deps)
setup:
	@test -f .env || cp .env.example .env
	npm install
