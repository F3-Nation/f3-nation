import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output → small container for Cloud Run.
  output: "standalone",
};

export default nextConfig;
