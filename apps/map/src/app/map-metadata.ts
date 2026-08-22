import type { Metadata } from "next";

import { env } from "~/env";

const mapBaseUrl = (() => {
  // F3_MAP_BASE_URL is typed required, but under skipValidation (CI/lint builds)
  // env.* passes through unvalidated and can be undefined — keep this fallback.
  const raw = env.F3_MAP_BASE_URL ?? process.env.F3_MAP_BASE_URL;
  if (!raw) return new URL("http://localhost:3000");
  return new URL(raw);
})();

export const mapMetadata: Metadata = {
  metadataBase: mapBaseUrl,
  title: "F3 Nation Map",
  description: "Find F3 locations near you",
  openGraph: {
    title: "F3 Nation Map",
    description: "Find F3 locations near you",
    url: mapBaseUrl,
    siteName: "F3 Nation Map",
  },
};
