import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@acme/logger"],
  // pino-pretty relies on worker threads (thread-stream); keep pino external so
  // Next.js does not try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
  images: {
    // Local fake-gcs emulator serves images from localhost, which Next.js 16's
    // image optimizer blocks by default (SSRF guard). Only bypass it when the
    // emulator is actually configured, never in staging/prod.
    dangerouslyAllowLocalIP: !!process.env.GCS_EMULATOR_HOST,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/f3-public-images/**",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/f3-public-images-staging/**",
      },
      // Local fake-gcs emulator (both prod- and staging-named buckets).
      {
        protocol: "http",
        hostname: "localhost",
        port: "9023",
        pathname: "/f3-public-images/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "9023",
        pathname: "/f3-public-images-staging/**",
      },
      {
        protocol: "https",
        hostname: "avatars.slack-edge.com",
      },
      {
        protocol: "https",
        hostname: "a.slack-edge.com",
      },
    ],
  },
};

export default nextConfig;
