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
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced search: fires automatically after the user pauses typing
  useEffect(() => {
    // Cancel any in-flight request immediately on dependency change.
    abortRef.current?.abort();

    if (!open) {
      setLoading(false);
      return;
    }

    const trimmed = search.trim();
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

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
  }, [open, search]);

  // Clear results when dropdown closes and cancel any in-flight request
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setResults([]);
    }
  }, [open]);

  // Resolve selectedUser display label when value is set but user isn't loaded yet
  const resolvedRef = useRef<number | null>(null);
  useEffect(() => {
    if (value == null) {
      resolvedRef.current = null;
      if (selectedUser !== null) setSelectedUser(null);
      return;
    }

    if (selectedUser !== null && selectedUser.id !== value) {
      setSelectedUser(null);
      resolvedRef.current = null;
      return;
    }

    if (selectedUser !== null || resolvedRef.current === value) return;

    void (async () => {
      try {
        const res = await fetch(`/api/users?userId=${value}`);
        if (!res.ok) {
          if (resolvedRef.current === value) resolvedRef.current = null;
          return;
        }
        const data = (await res.json()) as { users: UserListItem[] };
        const found = data.users.find((u) => u.id === value);
        if (found) {
          setSelectedUser(found);
          resolvedRef.current = value;
        } else if (resolvedRef.current === value) {
          resolvedRef.current = null;
        }
      } catch {
        if (resolvedRef.current === value) resolvedRef.current = null;
        // Silently fail — trigger will show fallback text
      }
    })();
  }, [value, selectedUser]);

  return { results, loading, selectedUser, setSelectedUser };
}
