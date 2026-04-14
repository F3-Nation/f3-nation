// @ts-check

/**
 * F3 redirect runtime Next.js config.
 *
 * - `output: "standalone"` for Cloud Run containerized deploy (F3R5_004).
 * - `transpilePackages` so the workspace `@acme/redirect-platform-db` is
 *   compiled on the fly — matches the pattern used by `apps/auth` and
 *   `apps/api`.
 * - `logging.fetches.fullUrl: false` — don't emit tenant hostnames in
 *   fetch debug lines; the runtime only makes one outbound connection
 *   (Neon) anyway, but we keep the toggle explicit.
 * - ESLint/TypeScript errors are checked by the `lint` and `typecheck`
 *   turbo tasks, not at build time, same as every other app in this repo.
 */

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@acme/redirect-platform-db"],
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default config;
