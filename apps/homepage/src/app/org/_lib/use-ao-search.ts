import { useEffect, useRef, useState } from "react";

import type { AoSearchResult } from "./types";
import { searchAos } from "./api";

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;
const NO_RESULTS: AoSearchResult[] = [];

// The outcome of the last request that finished, tagged with the query it
// answered.
interface SettledSearch {
  query: string;
  results: AoSearchResult[];
  error: boolean;
}

/**
 * Debounced, server-backed AO search. Mirrors the `Me` app's user-search hook:
 * waits for a typing pause, requires ≥2 chars, and aborts any in-flight request
 * when the query changes. `/org` is a static export, so `searchAos` calls the
 * API directly from the browser (Bearer key) rather than via a route handler.
 */
export function useAoSearch(query: string): {
  results: AoSearchResult[];
  loading: boolean;
  error: boolean;
} {
  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_SEARCH_LENGTH;
  // Only a result for the current query counts. Anything else means the new
  // query is still waiting on its debounce or request, so it reads as empty
  // and loading: Enter can't select stale AOs, and the empty-results UI
  // doesn't flash "No matches" before the request even starts.
  const current = searchable && settled?.query === trimmed ? settled : null;

  useEffect(() => {
    abortRef.current?.abort();

    if (trimmed.length < MIN_SEARCH_LENGTH) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      searchAos(trimmed, controller.signal)
        .then((aos) => {
          if (controller.signal.aborted) return;
          setSettled({ query: trimmed, results: aos, error: false });
        })
        .catch(() => {
          // An aborted request was superseded by a newer query, not a
          // failure — only a real fetch failure gets the distinct error
          // state, so it isn't confused with "no matches".
          if (controller.signal.aborted) return;
          setSettled({ query: trimmed, results: [], error: true });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [trimmed]);

  return {
    results: current?.results ?? NO_RESULTS,
    loading: searchable && !current,
    error: current?.error ?? false,
  };
}
