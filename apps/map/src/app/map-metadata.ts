import type { Metadata } from "next";

import { env } from "~/env";

const mapBaseUrl = (() => {
  // Validation is skipped in CI/lint builds, where required values can be
  // absent. Keep localhost as the deterministic metadata fallback.
  const raw = env.F3_MAP_BASE_URL;
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
