import { useEffect, useRef, useState } from "react";

import type { AoSearchResult } from "./types";
import { searchAos } from "./api";

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

/**
 * Debounced, server-backed AO search. Mirrors the `Me` app's user-search hook:
 * waits for a typing pause, requires ≥2 chars, and aborts any in-flight request
 * when the query changes. `/org` is a static export, so `searchAos` calls the
 * API directly from the browser (Bearer key) rather than via a route handler.
 */
export function useAoSearch(query: string): {
  results: AoSearchResult[];
  loading: boolean;
} {
  const [results, setResults] = useState<AoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    const trimmed = query.trim();
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Drop prior query results immediately so Enter cannot select stale AOs
    // while the debounce timer for the new query is still running.
    setResults([]);

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setLoading(true);
      searchAos(trimmed, controller.signal)
        .then((aos) => {
          if (controller.signal.aborted) return;
          setResults(aos);
          setLoading(false);
        })
        .catch(() => {
          // Superseded/failed request — surface as an empty result, not noise.
          if (controller.signal.aborted) return;
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [query]);

  return { results, loading };
}
