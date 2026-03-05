"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { useSave } from "@/lib/save-context";

export function Navbar() {
  const { user, loading, signOut } = useAuth();
  const { isDirty, saving, save } = useSave();

  return (
    <nav className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-primary"
            >
              <rect width="32" height="32" rx="6" fill="currentColor" />
              <text
                x="16"
                y="16"
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontFamily="sans-serif"
                fontWeight="bold"
                fontSize="14"
              >
                F3
              </text>
            </svg>
            <span className="text-lg font-bold">F3 Me</span>
          </Link>
          {process.env.NEXT_PUBLIC_SITE_URL?.includes("staging") && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-600">
              Staging
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isDirty && (
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving\u2026" : "Save Changes"}
            </Button>
          )}
          {!loading && user && (
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
