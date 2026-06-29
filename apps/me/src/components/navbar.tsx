"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSave } from "@/lib/save-context";

export function Navbar() {
  const { user, loading, signOut } = useAuth();
  const { isDirty, saving, save } = useSave();
  const [isStaging, setIsStaging] = useState(false);

  useEffect(() => {
    setIsStaging(window.location.hostname.includes("staging"));
  }, []);

  return (
    <nav className="sticky top-0 z-40 w-full bg-[hsl(var(--f3-charcoal))] text-[#f8f4ea]">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/f3_logo.png"
              alt="F3 Nation"
              width={32}
              height={32}
              className="rounded-sm"
            />
            <span className="text-lg font-bold tracking-tight">F3 Me</span>
          </Link>
          {isStaging && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
              Staging
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isDirty && (
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Saving\u2026" : "Save Changes"}
            </Button>
          )}
          {!loading && user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-[#f8f4ea]/70 hover:bg-white/10 hover:text-[#f8f4ea]"
            >
              Sign out
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
