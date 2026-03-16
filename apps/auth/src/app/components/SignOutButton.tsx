"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export default function SignOutButton() {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="space-y-4 rounded-md border border-destructive/50 bg-destructive/5 p-5">
        <p className="text-base font-medium text-destructive">
          You will be logged out of all apps that use F3 Auth.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex-1 rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Log Out
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-md border px-4 py-3 text-base font-medium hover:bg-accent transition-colors"
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
      className="w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      Log Out
    </button>
  );
}
