"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";

export const RETRY_BASE_MS = 30_000;
// Every open tab lands here at the same moment an outage starts; jitter keeps
// their retries from arriving at the recovering API in one synchronized wave.
const RETRY_JITTER = 0.2;

export function retryDelayMs(random: () => number = Math.random): number {
  return Math.round(RETRY_BASE_MS * (1 + (random() * 2 - 1) * RETRY_JITTER));
}

/**
 * Shown in place of an app's content when the F3 Nation API cannot be reached.
 * Reloads itself while visible, so users land back where they were once the
 * API recovers without having to notice and refresh.
 */
export function ApiUnavailable(props: {
  title: string;
  message: string;
  logo?: ReactNode;
}) {
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
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        {props.logo && <div className="mx-auto mb-4">{props.logo}</div>}
        <CardTitle className="text-2xl">{props.title}</CardTitle>
        <CardDescription>{props.message}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          This page will retry automatically every 30 seconds or so.
        </p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </CardContent>
    </Card>
  );
}
