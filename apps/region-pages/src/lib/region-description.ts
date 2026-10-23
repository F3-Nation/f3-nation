import type { ReactNode } from "react";

import { htmlToPlainText, useSanitizedHtml } from "@/lib/safe-html";

export const defaultRegionDescription =
  "Free, peer-led workouts for men. Open to all men, held outdoors, rain or shine, hot or cold.";

/**
 * The region's sanitized description, or the default when it has no visible
 * text (blank, or markup only). Never the raw string, so stray tags are never
 * shown as text.
 */
export function useRegionDescription(
  description: string | null | undefined,
): ReactNode[] {
  const hasText = htmlToPlainText(description).trim().length > 0;
  return useSanitizedHtml(hasText ? description : defaultRegionDescription);
}
