'use client';

import type { ReactNode } from 'react';
import { sanitizeHtmlToReactNodes } from '@/utils/safeHtml';

const EMAIL_SPLIT_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const EMAIL_MATCH_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;

/**
 * @see http://localhost:3000/anaheim
 * @see https://github.com/F3-Nation/f3-region-pages/issues/35
 * @todo "Click here for detailed AO maps"
 **/
export const WorkoutNotes = ({ notes }: { notes: string | null }) => {
  if (!notes) return null;

  const sanitizedNotes = sanitizeHtmlToReactNodes(notes);
  const enrichedNotes = enrichEmails(sanitizedNotes);

  if (enrichedNotes.length === 0) {
    return null;
  }

  return (
    <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line">
      <div className="font-medium mb-1">Notes:</div>
      {enrichedNotes}
    </div>
  );
};

const enrichEmails = (nodes: ReactNode[]): ReactNode[] => {
  return nodes.flatMap((node, idx) => enrichNodeWithEmails(node, idx));
};

const enrichNodeWithEmails = (node: ReactNode, index: number): ReactNode[] => {
  if (typeof node === 'string') {
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
