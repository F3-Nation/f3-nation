import type { ReactNode } from "react";

import { hasVisibleContent, useSanitizedHtml } from "@/lib/safe-html";

export const defaultRegionDescription =
  "Free, peer-led workouts for men. Open to all men, held outdoors, rain or shine, hot or cold.";

/**
 * The region's sanitized description, or the default when it shows nothing
 * (blank, or markup only; a link with no text still counts, as its URL).
 * Never the raw string, so stray tags are never shown as text.
 */
export function useRegionDescription(
  description: string | null | undefined,
): ReactNode[] {
  return useSanitizedHtml(
    hasVisibleContent(description) ? description : defaultRegionDescription,
  );
}
