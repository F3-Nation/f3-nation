import type { NextConfig } from "next";

// Next's inline RSC payload and the GA bootstrap need 'unsafe-inline' scripts
// (no nonce pipeline); sources, framing, base and form targets stay locked down.
// Dev adds 'unsafe-eval' for React refresh.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://www.googletagmanager.com`,
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  "img-src 'self' data: blob: https://storage.googleapis.com https://*.google-analytics.com https://*.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // "Near me" is the only browser capability the app uses.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  headers: () =>
    Promise.resolve([{ source: "/:path*", headers: securityHeaders }]),
  transpilePackages: ["@acme/logger"],
  // pino-pretty relies on worker threads (thread-stream); keep pino external so
  // Next.js does not try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],

  // Turbopack's standalone trace drops the dlopen'd libvips shared library from
  // @img/sharp-libvips-*; force the complete packages into the trace. A zero-match
  // glob is a silent no-op, so the Dockerfile asserts libvips landed in standalone.
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/.pnpm/@img+sharp-libvips-*/**/*"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/f3-logos/**",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/backblast-images/**",
      },
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
    ],
  },
};

export default nextConfig;
