"use client";

import { useRouter } from "next/navigation";

import type { AdminSession } from "~/lib/auth/session";
import { navigateToSsoLogout } from "~/lib/auth/client";
import { AuthWrapper } from "../components/auth-components";

export const AlreadySignedIn = ({ session }: { session: AdminSession }) => {
  const router = useRouter();
  return (
    <AuthWrapper className="mx-auto max-w-md">
      <h2 className="mt-2 text-2xl font-semibold">
        {`You're already signed in as ${session.email}`}
      </h2>
      <div className="mt-2">Would you like to sign out?</div>
      <button
        className="mt-4 w-full rounded-md bg-foreground px-4 py-4 text-background"
        onClick={() => navigateToSsoLogout()}
      >
        Sign out
      </button>
      <button
        className="mt-4 w-full rounded-md bg-foreground px-4 py-4 text-background"
        onClick={() => router.push("/")}
      >
        Cancel
      </button>
    </AuthWrapper>
  );
};
