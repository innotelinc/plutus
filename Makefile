.PHONY: all build dev push seed test clean help

# Autodetect the host's LAN IP (PLUTUS_HOST overrides). All targets below use
# it so the stack works on any machine without hardcoded addresses.
LAN_IP := $(shell node scripts/lan-ip.mjs)

# Default target
all: help

## help: Show this help message
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'

## build: Build the Next.js static export (bakes in the autodetected LAN IP)
build:
	NEXT_PUBLIC_CONVEX_URL=http://$(LAN_IP):3210 \
	NEXT_PUBLIC_CONVEX_SITE_URL=http://$(LAN_IP):3211 \
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

## test: Run verification tests against the running stack
test:
	@echo "Running playback test against http://$(LAN_IP):3000 ..."
	timeout 120 node scripts/browser-check.mjs play http://$(LAN_IP):3000
	@echo ""
	@echo "Running submit test..."
	timeout 120 node scripts/browser-check.mjs submit http://$(LAN_IP):3000

## clean: Clean build artifacts
clean:
	rm -rf out/.next node_modules/.cache

## setup: One-command setup (copy .env.example, install deps)
setup:
	@test -f .env || cp .env.example .env
	npm install
