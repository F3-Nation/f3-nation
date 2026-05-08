import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { UserListItem } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseUserSearchOptions {
  value: number | null;
  homeRegionId: number | null;
  open: boolean;
  search: string;
}

export interface UseUserSearchReturn {
  users: UserListItem[];
  filteredUsers: UserListItem[];
  loading: boolean;
  selectedUser: UserListItem | null;
  isRegionScoped: boolean;
  setSelectedUser: (user: UserListItem | null) => void;
  handleExpandAll: () => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/** Build a display string for a user in the dropdown. */
export function displayName(u: UserListItem): string {
  const parts: string[] = [];
  if (u.f3Name) parts.push(u.f3Name);
  if (u.homeRegionName) parts.push(`\u2014 ${u.homeRegionName}`);
  return parts.join(" ") || `User #${u.id}`;
}

/** Check whether a user matches a search term (case-insensitive). */
export function matchesSearch(u: UserListItem, term: string): boolean {
  const lower = term.toLowerCase();
  return (
    (u.f3Name?.toLowerCase().includes(lower) ?? false) ||
    (u.homeRegionName?.toLowerCase().includes(lower) ?? false)
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUserSearch({
  value,
  homeRegionId,
  open,
  search,
}: UseUserSearchOptions): UseUserSearchReturn {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAllRegions, setShowAllRegions] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const scopedRegionId =
    showAllRegions || !homeRegionId ? undefined : homeRegionId;

  const fetchUsers = useCallback(
    async (regionId?: number | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (regionId) {
          params.set("homeRegionId", String(regionId));
        }
        const qs = params.toString();
        const res = await fetch(`/api/users${qs ? `?${qs}` : ""}`);
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = (await res.json()) as { users: UserListItem[] };
        setUsers(data.users);

        // Resolve selected user display if we have a value
        if (value && !selectedUser) {
          const found = data.users.find((u) => u.id === value);
          if (found) setSelectedUser(found);
        }
      } catch (err) {
        console.error("Failed to load users:", err);
      } finally {
        setLoading(false);
      }
    },
    [value, selectedUser],
  );

  // Load users when dropdown opens
  const previousScopeRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!open) return;

    const scopeChanged = previousScopeRef.current !== scopedRegionId;
    if (users.length > 0 && !scopeChanged) return;

    previousScopeRef.current = scopedRegionId;
    void fetchUsers(scopedRegionId);
  }, [open, users.length, scopedRegionId, fetchUsers]);

  // If we have a value but no selectedUser, try to resolve it.
  // Tracks the last resolved value so that changing to a new value triggers a fresh fetch.
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

    resolvedRef.current = value;

    void (async () => {
      try {
        const res = await fetch("/api/users");
        if (!res.ok) return;
        const data = (await res.json()) as { users: UserListItem[] };
        const found = data.users.find((u) => u.id === value);
        if (found) setSelectedUser(found);
      } catch {
        // Silently fail — display will fallback
      }
    })();
  }, [value, selectedUser]);

  const handleExpandAll = useCallback(() => {
    setShowAllRegions(true);
    setUsers([]); // Clear so the load effect refetches
  }, []);

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    return users.filter((u) => matchesSearch(u, search));
  }, [users, search]);

  const isRegionScoped = !showAllRegions && !!homeRegionId;

  return {
    users,
    filteredUsers,
    loading,
    selectedUser,
    isRegionScoped,
    setSelectedUser,
    handleExpandAll,
  };
}
