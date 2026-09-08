import type { NextConfig } from "next";

// NEXT_SKIP_CHECKS=1 disables the TypeScript + ESLint build phases. Used by
// the docker image build (deploy/web.Dockerfile) to keep memory/time bounded
// on small hosts; normal `bun run build` builds keep full checks on.
const skipChecks = process.env.NEXT_SKIP_CHECKS === "1";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  ...(skipChecks
    ? {
        typescript: { ignoreBuildErrors: true },
        eslint: { ignoreDuringBuilds: true },
      }
    : {}),
  experimental: {
    // Cap the number of parallel static-page generation workers. Keeps builds
    // within small memory budgets (docker); bump it for big sites / fast CI.
    staticGenerationMaxConcurrency: Number(
      process.env.NEXT_STATIC_GENERATION_MAX_CONCURRENCY ?? 2,
    ),
  },
};

export default nextConfig;
