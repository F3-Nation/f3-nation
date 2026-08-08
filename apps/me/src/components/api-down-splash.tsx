"use client";

import { useEffect } from "react";
import Image from "next/image";

export function ApiDownSplash() {
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
      <Image
        src="/f3_logo.png"
        alt="F3 Nation"
        width={120}
        height={120}
        priority
      />
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Be Back Soon, PAX</h1>
        <p className="max-w-md text-muted-foreground">
          The backend API that supports this app isn&apos;t running right now.
          Please try back later. You can also check{" "}
          <a
            href="https://f3nation.com/status"
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            f3nation.com/status
          </a>{" "}
          for updates.
        </p>
        <p className="text-sm text-muted-foreground">
          This page will refresh automatically every 30 seconds.
        </p>
      </div>
    </div>
  );
}
