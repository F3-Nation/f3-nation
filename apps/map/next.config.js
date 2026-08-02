import { fileURLToPath } from "url";
import _jiti from "jiti";

const jiti = _jiti(fileURLToPath(import.meta.url));

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
jiti("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,

  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@acme/api",
    "@acme/auth",
    "@acme/db",
    "@acme/logger",
    "@acme/ui",
    "@acme/validators",
  ],

  // pino-pretty relies on worker threads (thread-stream); keep pino external so
  // Next.js does not try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],

  // Turbopack's standalone trace drops the dlopen'd libvips shared library from
  // @img/sharp-libvips-*; force the complete packages into the trace. A zero-match
  // glob is a silent no-op, so the Dockerfile asserts libvips landed in standalone.
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/.pnpm/@img+sharp-libvips-*/**/*"],
    // The /changelog page is generated from this file at build time.
    "/changelog": ["./CHANGELOG.md"],
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "imgur.com",
        pathname: "/*",
      },
    ],
  },

  /** We already do typechecking as a separate task in CI */
  typescript: { ignoreBuildErrors: true },
  redirects: async () => {
    const adminUrl = (
      process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.f3nation.com"
    ).replace(/\/$/, "");
    return [
      {
        source: "/map",
        destination: "/",
        permanent: true,
      },
      {
        source: "/admin",
        destination: adminUrl,
        permanent: false,
      },
      {
        source: "/admin/:path*",
        destination: `${adminUrl}/:path*`,
        permanent: false,
      },
    ];
  },
};

export default config;
