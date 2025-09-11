"use client";

import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { AuthWrapper } from "../components/auth-components";

export const AlreadySignedIn = () => {
  const { data: session } = useSession();

  const router = useRouter();
  return (
    <AuthWrapper>
      <h2 className="mt-2 text-2xl font-semibold">
        {`You're already signed in as ${session?.user?.email}`}
      </h2>
      <div className="mt-2">Would you like to sign out?</div>
      <button
        className="mt-4 w-full rounded-md bg-foreground px-4 py-4 text-background"
        onClick={() => signOut()}
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
