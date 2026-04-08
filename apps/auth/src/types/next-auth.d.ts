import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    onboardingCompleted?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: number;
    onboardingCompleted?: boolean;
    meta?: unknown;
    status?: string;
  }
}
