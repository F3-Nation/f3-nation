/**
 * Browser-side Better Auth client for the /api/auth2 instance. Imported
 * unconditionally; only called when the server passes `useBetterAuth`.
 * The flag is server-only, so pages read it and pass it down as a prop
 * instead of exposing a NEXT_PUBLIC_ var.
 */
"use client";

import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL,
  // Must match apps/auth/src/lib/better-auth.ts's basePath — Better Auth's
  // client default ("/api/auth") would collide with NextAuth's own routes,
  // same reason the server side can't use the default either.
  basePath: "/api/auth2",
  plugins: [emailOTPClient()],
});
