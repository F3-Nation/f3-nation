import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for the Cloud Run
  // Docker image. Firebase App Hosting did not require this; the Dockerfile does.
  output: 'standalone',
  // In the monorepo, trace the workspace ROOT so the standalone bundle includes
  // the hoisted node_modules (two levels up from apps/region-pages).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/f3-logos/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/backblast-images/**',
      },
    ],
  },
  // Improve cache handling and build consistency
  generateBuildId: async () => {
    // Use git commit hash if available, otherwise use timestamp
    return (
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      `build-${Date.now()}`
    );
  },
  // Ensure proper cache headers for static assets
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
