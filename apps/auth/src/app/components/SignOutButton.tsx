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
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleLogout() {
    setError("");

    try {
      // Revoke all refresh tokens so client apps can't get new access
      // tokens. fetch() doesn't reject on an HTTP error status, so check
      // response.ok explicitly — otherwise a failed revoke still redirects
      // to /login as if nothing went wrong, leaving live refresh tokens
      // behind. A rejected fetch (network failure) falls through to the
      // catch block below.
      // A 401 means the server already has no session for this user (it
      // expired, or was revoked elsewhere) — there's nothing left to
      // revoke and retrying can never succeed, so treat it the same as a
      // successful revoke and continue to the local sign-out below.
      const logoutRes = await fetch("/api/logout", { method: "POST" });
      if (!logoutRes.ok && logoutRes.status !== 401) {
        setError("Failed to log out. Please try again.");
        return;
      }

      // Clear the active backend's session cookie and redirect to login —
      // NextAuth's own signOut() only clears its own cookie, so a Better
      // Auth session (see apps/auth/src/lib/current-session.ts) needs its
      // own client's signOut() instead, or the user stays signed in there.
      if (useBetterAuth) {
        const { error: signOutError } = await authClient.signOut();
        if (signOutError) {
          setError("Failed to log out. Please try again.");
          return;
        }
        router.push("/login");
      } else {
        await signOut({ callbackUrl: "/login" });
      }
    } catch {
      setError("Failed to log out. Please try again.");
    }
  }

  if (confirming) {
    return (
      <div className="space-y-4 rounded-md border border-destructive/50 bg-destructive/5 p-5">
        <p className="text-base font-medium text-destructive">
          You will be logged out of all apps that use F3 Auth.
        </p>
        {error && <p className="text-base text-destructive">{error}</p>}
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
