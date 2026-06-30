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

  webpack: (config, { webpack }) => {
    // https://github.com/handlebars-lang/handlebars.js/issues/1174#issuecomment-229918935
    config.resolve.alias.handlebars = "handlebars/dist/handlebars.min.js";
    return config;
  },
  reactStrictMode: true,

  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@acme/api",
    "@acme/auth",
    "@acme/db",
    "@acme/logger",
    "@acme/mail",
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
    return [
      {
        source: "/map",
        destination: "/",
        permanent: true,
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

  // Webpack-plugin build options. Only applied when building with webpack; the
  // default Turbopack build ignores these. (Sentry v10 moved disableLogger and
  // autoInstrumentServerFunctions under the webpack namespace.)
  webpack: {
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    treeshake: { removeDebugLogging: true },

    // This app is App Router only — it has no pages/ API routes or data-fetching
    // functions (getServerSideProps, etc.). Disabling auto-instrumentation of
    // Pages Router server functions avoids unnecessary webpack loader overhead.
    autoInstrumentServerFunctions: false,
  },
});
