"use client";

import { useEffect } from "react";
import Image from "next/image";
import { apiRetryDelayMs } from "@acme/shared/app/api-availability";
import { Button } from "@/components/ui/button";

/**
 * Shown by the profile page in place of the form when the F3 Nation API
 * cannot be reached. Reloads itself while visible, so a PAX lands back on
 * their profile once the API recovers without having to notice and refresh.
 */
export function ApiUnavailable() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        // A background tab has no one waiting on it; check again later
        // instead of adding load to an API that is already struggling.
        if (document.visibilityState === "visible") {
          window.location.reload();
        } else {
          schedule();
        }
      }, apiRetryDelayMs());
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <div
        role="alert"
        className="flex max-w-md flex-col items-center space-y-4 rounded-lg border bg-card p-8 text-center shadow-lg"
      >
        <Image
          src="/f3_logo.png"
          alt="F3 Nation"
          width={80}
          height={80}
          className="rounded-xl"
        />
        <h1 className="text-2xl font-semibold">
          F3 Me is temporarily unavailable
        </h1>
        <p className="text-muted-foreground">
          The F3 Nation API is not responding, so your profile cannot load right
          now. Your account is fine.
        </p>
        <p className="text-sm text-muted-foreground">
          This page will retry automatically every 30 seconds or so.
        </p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </div>
    </div>
  );
}
