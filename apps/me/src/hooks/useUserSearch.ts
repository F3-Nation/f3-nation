import { useState, useEffect, useRef } from "react";
import type { UserListItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseUserSearchOptions {
  value: number | null;
  open: boolean;
  search: string;
}

export interface UseUserSearchReturn {
  results: UserListItem[];
  loading: boolean;
  selectedUser: UserListItem | null;
  setSelectedUser: (user: UserListItem | null) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Build a display string for a user in the dropdown. */
export function displayName(u: UserListItem): string {
  if (u.f3Name && u.homeRegionName)
    return `${u.f3Name} \u2014 ${u.homeRegionName}`;
  if (u.f3Name) return u.f3Name;
  return `User #${u.id}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUserSearch({
  value,
  open,
  search,
}: UseUserSearchOptions): UseUserSearchReturn {
  const [results, setResults] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUserState, setSelectedUser] = useState<UserListItem | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = search.trim();
  const searchActive = open && trimmed.length >= MIN_SEARCH_LENGTH;

  // Clear results/loading when search becomes inactive (dropdown closed or
  // query too short). Adjusting state during render instead of in an effect
  // avoids an extra render showing stale results.
  const [prevSearchActive, setPrevSearchActive] = useState(searchActive);
  if (searchActive !== prevSearchActive) {
    setPrevSearchActive(searchActive);
    if (!searchActive) {
      setResults([]);
      setLoading(false);
    }
  }

  // Debounced search: fires automatically after the user pauses typing
  useEffect(() => {
    // Cancel any in-flight request immediately on dependency change
    // (this also covers the dropdown closing).
    abortRef.current?.abort();

    if (!searchActive) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ searchTerm: trimmed });
      fetch(`/api/users?${params.toString()}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch users");
          return res.json() as Promise<{ users: UserListItem[] }>;
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(data.users.filter((u) => !!u.f3Name));
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          console.error("Failed to load users:", err);
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [searchActive, trimmed]);

  // selectedUser is derived: it is only valid while it matches `value`.
  const selectedUser =
    value != null && selectedUserState?.id === value ? selectedUserState : null;

  // Resolve selectedUser display label when value is set but the matching user
  // isn't loaded yet. Re-runs only when `value` or the derived `selectedUser`
  // changes, so a failed fetch for the same value is not retried in a loop,
  // while restoring a previously-seen value (whose user was replaced by a
  // different selection) fetches it again.
  useEffect(() => {
    if (value == null || selectedUser !== null) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(`/api/users?userId=${value}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { users: UserListItem[] };
        if (controller.signal.aborted) return;
        const found = data.users.find((u) => u.id === value);
        if (found) setSelectedUser(found);
      } catch {
        // Silently fail — trigger will show fallback text
      }
    })();

    return () => controller.abort();
  }, [value, selectedUser]);

  return { results, loading, selectedUser, setSelectedUser };
}
