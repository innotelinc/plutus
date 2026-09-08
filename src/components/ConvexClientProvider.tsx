"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

// Default points at the self-hosted Convex backend (docker compose). Override
// with NEXT_PUBLIC_CONVEX_URL for a remote/cloud deployment.
const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";

const SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "http://127.0.0.1:3211";

// Inline the client so the site URL is accessible without polluting the global scope.
// The Convex backend exposes HTTP actions / the site proxy on SITE_URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).PIXELSHOP_SITE_URL = SITE_URL;
const convex = new ConvexReactClient(CONVEX_URL);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
