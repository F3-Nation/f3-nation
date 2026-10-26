import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@acme/observability"],
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
