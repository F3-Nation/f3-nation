import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@acme/logger"],
  // pino-pretty relies on worker threads (thread-stream); keep pino external so
  // Next.js does not try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],

  // Turbopack's standalone trace drops the dlopen'd libvips shared library from
  // @img/sharp-libvips-*; force the complete packages into the trace. A zero-match
  // glob is a silent no-op, so the Dockerfile asserts libvips landed in standalone.
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/.pnpm/@img+sharp-libvips-*/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/f3-logos/**",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/backblast-images/**",
      },
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
    ],
  },
};

export default nextConfig;
