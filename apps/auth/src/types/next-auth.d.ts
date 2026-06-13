import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    onboardingCompleted?: boolean;
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
  }
}
