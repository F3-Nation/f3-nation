"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

import { authClient } from "~/lib/better-auth-client";

export default function SignOutButton({
  useBetterAuth,
}: {
  useBetterAuth: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    // Revoke all refresh tokens so client apps can't get new access tokens
    await fetch("/api/logout", { method: "POST" });
    // Clear the active backend's session cookie and redirect to login —
    // NextAuth's own signOut() only clears its own cookie, so a Better
    // Auth session (see apps/auth/src/lib/current-session.ts) needs its
    // own client's signOut() instead, or the user stays signed in there.
    if (useBetterAuth) {
      await authClient.signOut();
      router.push("/login");
    } else {
      await signOut({ callbackUrl: "/login" });
    }
  }

  if (confirming) {
    return (
      <div className="space-y-4 rounded-md border border-destructive/50 bg-destructive/5 p-5">
        <p className="text-base font-medium text-destructive">
          You will be logged out of all apps that use F3 Auth.
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleLogout}
            className="flex-1 rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Log Out
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-md border px-4 py-3 text-base font-medium transition-colors hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      Log Out
    </button>
  );
}
