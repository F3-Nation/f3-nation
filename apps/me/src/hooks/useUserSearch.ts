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
  canRunOutsideRegionSearch: boolean;
  showOutsideRegionSearchAction: boolean;
  outsideRegionSearchActionLabel: string;
  hasPendingOutsideRegionSearch: boolean;
  setSelectedUser: (user: UserListItem | null) => void;
  handleExpandAll: () => void;
  runOutsideRegionSearch: () => void;
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
  const [submittedOutsideRegionSearch, setSubmittedOutsideRegionSearch] =
    useState<string | null>(null);
  const scopedRegionId =
    showAllRegions || !homeRegionId ? undefined : homeRegionId;
  const isRegionScoped = !showAllRegions && !!homeRegionId;
  const trimmedSearch = search.trim();
  const isOutsideRegionMode = !isRegionScoped;
  const canRunOutsideRegionSearch =
    isOutsideRegionMode && trimmedSearch.length >= 2;
  const hasPendingOutsideRegionSearch =
    isOutsideRegionMode &&
    trimmedSearch.length >= 2 &&
    trimmedSearch !== submittedOutsideRegionSearch;
  const showOutsideRegionSearchAction =
    isOutsideRegionMode && trimmedSearch.length >= 2;
  const outsideRegionSearchActionLabel = submittedOutsideRegionSearch
    ? "Update outside-region search"
    : "Search outside my home region";

  const fetchUsers = useCallback(
    async (options?: {
      userId?: number | null;
      regionId?: number | null;
      searchTerm?: string;
    }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (options?.userId) {
          params.set("userId", String(options.userId));
        }
        if (options?.regionId) {
          params.set("homeRegionId", String(options.regionId));
        }
        if (options?.searchTerm) {
          params.set("searchTerm", options.searchTerm);
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

  // Load users when dropdown opens or search changes
  const previousScopeRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    if (scopedRegionId === undefined) return;

    const scopeChanged = previousScopeRef.current !== scopedRegionId;

    if (users.length > 0 && !scopeChanged) return;

    previousScopeRef.current = scopedRegionId;
    void fetchUsers({ regionId: scopedRegionId });
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
        const res = await fetch(`/api/users?userId=${value}`);
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
    setSubmittedOutsideRegionSearch(null);
    setUsers([]);
  }, []);

  const runOutsideRegionSearch = useCallback(() => {
    if (!canRunOutsideRegionSearch) return;

    setSubmittedOutsideRegionSearch(trimmedSearch);
    void fetchUsers({ searchTerm: trimmedSearch });
  }, [canRunOutsideRegionSearch, fetchUsers, trimmedSearch]);

  useEffect(() => {
    if (!isOutsideRegionMode) return;
    if (submittedOutsideRegionSearch === null) return;
    if (trimmedSearch === submittedOutsideRegionSearch) return;
    if (users.length === 0) return;

    setUsers([]);
  }, [
    isOutsideRegionMode,
    submittedOutsideRegionSearch,
    trimmedSearch,
    users.length,
  ]);

  const filteredUsers = useMemo(() => {
    const withName = users.filter((u) => !!u.f3Name);
    if (isOutsideRegionMode) return withName;
    if (!search) return withName;
    return withName.filter((u) => matchesSearch(u, search));
  }, [users, search, isOutsideRegionMode]);

  return {
    users,
    filteredUsers,
    loading,
    selectedUser,
    isRegionScoped,
    canRunOutsideRegionSearch,
    showOutsideRegionSearchAction,
    outsideRegionSearchActionLabel,
    hasPendingOutsideRegionSearch,
    setSelectedUser,
    handleExpandAll,
    runOutsideRegionSearch,
  };
}
