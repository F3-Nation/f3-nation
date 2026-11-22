import { useCallback, useSyncExternalStore } from "react";

/**
 * Portrait phones: the complement of the side-by-side layout. Keep in step
 * with the `org-overlay` variant in app/globals.css.
 */
export const PHONE_PORTRAIT_MEDIA_QUERY =
  "(max-width: 767.98px) and (min-height: 500.02px), (max-width: 767.98px) and (orientation: portrait)";

/** Whether `query` matches, kept current as the window changes. False where
 * `matchMedia` is missing (e.g. test environments). */
export function useMediaQuery(query: string): boolean {
  // Stable per query, so re-renders don't re-subscribe the listener.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    () => false,
  );
}
