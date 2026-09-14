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
  error: boolean;
} {
  const [results, setResults] = useState<AoSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    const trimmed = query.trim();
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }

    // Drop prior query results immediately so Enter cannot select stale AOs
    // while the debounce timer for the new query is still running. Flip
    // `loading` synchronously too, so the empty-results UI doesn't flash
    // "No matches" for the debounce window before the request even starts.
    setResults([]);
    setLoading(true);
    setError(false);

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      searchAos(trimmed, controller.signal)
        .then((aos) => {
          if (controller.signal.aborted) return;
          setResults(aos);
          setLoading(false);
        })
        .catch(() => {
          // An aborted request was superseded by a newer query, not a
          // failure — only a real fetch failure gets the distinct error
          // state, so it isn't confused with "no matches".
          if (controller.signal.aborted) return;
          setResults([]);
          setLoading(false);
          setError(true);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [query]);

  return { results, loading, error };
}
