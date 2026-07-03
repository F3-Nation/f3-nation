import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";
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

export default withSentryConfig(config, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "f3-nation",
  project: "maps-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",
});
