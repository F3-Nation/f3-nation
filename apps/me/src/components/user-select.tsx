"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UserListItem } from "@/lib/types";

interface UserSelectProps {
  value: number | null;
  homeRegionId: number | null;
  onChange: (userId: number | null) => void;
}

function displayName(u: UserListItem): string {
  const parts: string[] = [];
  if (u.f3Name) parts.push(u.f3Name);
  const real = [u.firstName, u.lastName].filter(Boolean).join(" ");
  if (real) parts.push(`(${real})`);
  if (u.homeRegionName) parts.push(`— ${u.homeRegionName}`);
  return parts.join(" ") || `User #${u.id}`;
}

function matchesSearch(u: UserListItem, term: string): boolean {
  const lower = term.toLowerCase();
  return (
    (u.f3Name?.toLowerCase().includes(lower) ?? false) ||
    (u.firstName?.toLowerCase().includes(lower) ?? false) ||
    (u.lastName?.toLowerCase().includes(lower) ?? false) ||
    (u.homeRegionName?.toLowerCase().includes(lower) ?? false)
  );
}

export function UserSelect({ value, homeRegionId, onChange }: UserSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAllRegions, setShowAllRegions] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

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
  useEffect(() => {
    if (!open) return;
    if (users.length > 0) return; // Already loaded
    const regionIdToFetch =
      showAllRegions || !homeRegionId ? undefined : homeRegionId;
    void fetchUsers(regionIdToFetch);
  }, [open, showAllRegions, homeRegionId, users.length, fetchUsers]);

  // If we have a value but no selectedUser, try to resolve it
  useEffect(() => {
    if (value && !selectedUser) {
      // We need to fetch to resolve the display name of the selected user
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleExpandAll = () => {
    setShowAllRegions(true);
    setUsers([]); // Clear so the load effect refetches
  };

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    return users.filter((u) => matchesSearch(u, search));
  }, [users, search]);

  const isRegionScoped = !showAllRegions && !!homeRegionId;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        type="button"
        className="w-full justify-between text-left font-normal"
        onClick={() => setOpen(!open)}
      >
        <span
          className={`truncate ${value && selectedUser ? "" : "text-muted-foreground"}`}
        >
          {selectedUser ? displayName(selectedUser) : "Select a person..."}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="ml-2 shrink-0 opacity-50"
        >
          <path
            d="M2 4L6 8L10 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="p-2">
            <Input
              placeholder="Search by name or region..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {loading ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                Loading...
              </p>
            ) : (
              <>
                {value !== null && (
                  <button
                    type="button"
                    className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent"
                    onClick={() => {
                      onChange(null);
                      setSelectedUser(null);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    Clear selection
                  </button>
                )}
                {filteredUsers.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                    No users found.
                  </p>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className={`relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent ${
                        user.id === value ? "bg-accent font-medium" : ""
                      }${user.status !== "active" ? " opacity-50" : ""}`}
                      onClick={() => {
                        onChange(user.id);
                        setSelectedUser(user);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <span className="truncate">
                        {displayName(user)}
                        {user.status !== "active" && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (Inactive)
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                )}
                {isRegionScoped && (
                  <button
                    type="button"
                    className="relative flex w-full cursor-pointer select-none items-center justify-center rounded-sm border-t px-2 py-2 text-sm font-medium text-primary outline-none hover:bg-accent"
                    onClick={handleExpandAll}
                  >
                    Search outside my home region
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
