import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "./button";

export interface RouteNotFoundProps {
  title?: string;
  description?: string;
  /** Where the "Go back home" button points. */
  homeHref?: string;
}

/**
 * Shared body for every app's root `not-found.tsx`, so a bad URL renders a
 * consistent, on-brand 404 instead of Next's generic default.
 */
export function RouteNotFound({
  title = "Page not found",
  description = "The page you're looking for doesn't exist or may have moved.",
  homeHref = "/",
}: RouteNotFoundProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <SearchX className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <Button asChild>
        <Link href={homeHref}>Go back home</Link>
      </Button>
    </div>
  );
}
