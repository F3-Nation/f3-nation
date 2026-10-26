"use client";

import { useEffect } from "react";
import Image from "next/image";

import { Button } from "@acme/ui/button";

export const RETRY_BASE_MS = 30_000;
// Every open tab lands here at the same moment an outage starts; jitter keeps
// their retries from arriving at the recovering API in one synchronized wave.
const RETRY_JITTER = 0.2;

export function retryDelayMs(random: () => number = Math.random): number {
  return Math.round(RETRY_BASE_MS * (1 + (random() * 2 - 1) * RETRY_JITTER));
}

/**
 * Shown by the root layout in place of the portal when the API cannot be
 * reached. Reloads itself while visible, so admins land back in the portal
 * once the API recovers without having to notice and refresh.
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
      }, retryDelayMs());
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center space-y-4 text-center">
          <Image src="/f3_logo.png" alt="F3" width={80} height={80} />
          <h1 className="text-2xl font-semibold text-gray-900">
            Admin is temporarily unavailable
          </h1>
          <p className="text-gray-600">
            The F3 Nation API is not responding, so the admin portal cannot load
            right now.
          </p>
          <p className="text-sm text-gray-500">
            This page will retry automatically every 30 seconds or so.
          </p>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
