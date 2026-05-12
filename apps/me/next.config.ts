import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
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
      {
        protocol: "https",
        hostname: "avatars.slack-edge.com",
      },
      {
        protocol: "https",
        hostname: "a.slack-edge.com",
      },
    ],
  },
};

export default nextConfig;
