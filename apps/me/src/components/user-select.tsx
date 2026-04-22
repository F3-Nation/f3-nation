"use client";

import { useRef } from "react";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { useDropdownSelect } from "@/hooks/useDropdownSelect";
import { useUserSearch, displayName } from "@/hooks/useUserSearch";
import type { UserListItem } from "@/lib/types";

interface UserSelectProps {
  value: number | null;
  homeRegionId: number | null;
  onChange: (userId: number | null) => void;
}

export function UserSelect({ value, homeRegionId, onChange }: UserSelectProps) {
  const { open, search, toggle, close, setSearch, selectAndClose } =
    useDropdownSelect();
  const {
    filteredUsers,
    loading,
    selectedUser,
    isRegionScoped,
    setSelectedUser,
    handleExpandAll,
  } = useUserSearch({ value, homeRegionId, open, search });
  const dropdownRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        type="button"
        className="w-full justify-between text-left font-normal"
        onClick={toggle}
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
                      selectAndClose();
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
                  filteredUsers.map((user: UserListItem) => (
                    <button
                      key={user.id}
                      type="button"
                      className={`relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent ${
                        user.id === value ? "bg-accent font-medium" : ""
                      }${user.status !== "active" ? " opacity-50" : ""}`}
                      onClick={() => {
                        onChange(user.id);
                        setSelectedUser(user);
                        selectAndClose();
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

      {/* Click-away handler */}
      {open && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="fixed inset-0 z-40" onClick={close} />
      )}
    </div>
  );
}
