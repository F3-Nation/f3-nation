"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export default function SignOutButton() {
  const [confirming, setConfirming] = useState(false);

  async function handleLogout() {
    // Revoke all refresh tokens so client apps can't get new access tokens
    await fetch("/api/logout", { method: "POST" });
    // Clear the session cookie and redirect to login
    await signOut({ callbackUrl: "/login" });
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
