/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // The redirect-admin UI is server-only — no remote image hosts needed.
  reactStrictMode: true,
};

export default nextConfig;
