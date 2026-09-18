/**
 * Browser-side Better Auth client, mounted against the same isolated
 * /api/auth2 instance as apps/auth/src/lib/better-auth.ts. Only imported
 * from client components gated on AUTH_USE_BETTER_AUTH — see
 * apps/auth/src/app/login/email, apps/auth/src/app/login/email/verify, and
 * apps/auth/src/app/register, each of which now has a server `page.tsx`
 * that reads the flag and a client form component that branches on it.
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
