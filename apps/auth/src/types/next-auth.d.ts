import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    onboardingCompleted?: boolean;
    // ISO timestamp of this user's original sign-in for the session backing
    // this JWT — set once at login (see the jwt callback) and preserved
    // across every subsequent request, unlike iat/exp which move on each
    // encode. Read by /api/oauth/authorize to stamp the OIDC auth_time
    // claim with the *real* original login, not "whenever this particular
    // authorize request happened" (which can be much later, on an
    // already-live session).
    authTime?: string;
  }
}

// next-auth/jwt re-exports JWT from @auth/core/jwt (no own interface), so the
// augmentation must target @auth/core/jwt to merge — matching type-extensions.d.ts.
declare module "@auth/core/jwt" {
  interface JWT {
    userId?: number;
    onboardingCompleted?: boolean;
    meta?: unknown;
    status?: string;
    authTime?: string;
  }
}
