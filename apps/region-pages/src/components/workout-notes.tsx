"use client";

import type { ReactNode } from "react";
import { useSanitizedHtml } from "@/lib/safe-html";

const EMAIL_SPLIT_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const EMAIL_MATCH_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;

/** Render sanitized notes and link bare email addresses. */
export const WorkoutNotes = ({ notes }: { notes: string | null }) => {
  const sanitizedNotes = useSanitizedHtml(notes);
  if (!notes) return null;

  const enrichedNotes = enrichEmails(sanitizedNotes);

  if (enrichedNotes.length === 0) {
    return null;
  }

  return (
    <div className="text-sm whitespace-pre-line text-gray-500 dark:text-gray-400">
      <div className="mb-1 font-medium">Notes:</div>
      {enrichedNotes}
    </div>
  );
};

const enrichEmails = (nodes: ReactNode[]): ReactNode[] => {
  return nodes.flatMap((node, idx) => enrichNodeWithEmails(node, idx));
};

const enrichNodeWithEmails = (node: ReactNode, index: number): ReactNode[] => {
  if (typeof node === "string") {
    const segments = node.split(EMAIL_SPLIT_REGEX);

    return segments
      .filter((segment) => segment.length > 0)
      .map((segment, segmentIdx) => {
        if (EMAIL_MATCH_REGEX.test(segment)) {
          return (
            <a key={`email-${index}-${segmentIdx}`} href={`mailto:${segment}`}>
              {segment}
            </a>
          );
        }

        return segment;
      });
  }

  return [node];
};
