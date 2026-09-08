.PHONY: all help setup build dev push seed test verify up down logs ps clean

# Autodetect the host's LAN IP (PLUTUS_HOST overrides). All targets below use
# it so the stack works on any machine without hardcoded addresses.
LAN_IP := $(shell node scripts/lan-ip.mjs)

# Default target
all: help

## help: Show this help message
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'

## ---- Bootstrap ----

## setup: One-command setup (copy .env.example, install deps, install git hooks)
setup:
	@bash setup.sh

## ---- Core platform ----

## build: Build the Next.js static export (bakes in the autodetected LAN IP)
build:
	NEXT_PUBLIC_CONVEX_URL=http://$(LAN_IP):3210 \
	NEXT_PUBLIC_CONVEX_SITE_URL=http://$(LAN_IP):3211 \
	npm run build

## dev: Start development server
dev:
	npm run dev

## push: Push functions + seed demo data to the self-hosted backend
push:
	./scripts/push-and-seed.sh

## seed: Seed demo data to Convex
seed:
	./scripts/push-and-seed.sh

## test: Run unit tests (PNG encoder, script parser)
test:
	bun test

## verify: Run browser verification against the running stack
verify:
	@echo "Running playback test against http://$(LAN_IP):3000 ..."
	timeout 120 node scripts/browser-check.mjs play http://$(LAN_IP):3000
	@echo ""
	@echo "Running submit test..."
	timeout 170 node scripts/browser-check.mjs submit https://example.com

## ---- Stack lifecycle ----

## up: Start the docker compose stack
up:
	docker compose up -d

## down: Stop the docker compose stack
down:
	docker compose down

## logs: Tail backend logs
logs:
	docker compose logs -f backend

## ps: Show container status
ps:
	docker compose ps

## clean: Clean build artifacts
clean:
	rm -rf out/.next node_modules/.cache
