// @ts-check

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@acme/db", "@acme/logger", "@acme/shared"],
  // pino-pretty relies on worker threads (thread-stream); keep pino external so
  // Next.js does not try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],

  // Turbopack's standalone trace drops the dlopen'd libvips shared library from
  // @img/sharp-libvips-*; force the complete packages into the trace. A zero-match
  // glob is a silent no-op, so the Dockerfile asserts libvips landed in standalone.
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/.pnpm/@img+sharp-libvips-*/**/*"],
  },
  typescript: { ignoreBuildErrors: true },
};

export default config;
