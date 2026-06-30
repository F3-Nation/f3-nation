"use client";

import { useRef, useState, useCallback } from "react";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { useDropdownSelect } from "@/hooks/useDropdownSelect";
import { useUserSearch, displayName } from "@/hooks/useUserSearch";
import type { UserListItem } from "@/lib/types";

interface UserSelectProps {
  value: number | null;
  onChange: (userId: number | null) => void;
}

export function UserSelect({ value, onChange }: UserSelectProps) {
  const { open, search, toggle, close, setSearch, selectAndClose } =
    useDropdownSelect();
  const { results, loading, selectedUser, setSelectedUser } = useUserSearch({
    value,
    open,
    search,
  });
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const clearOffset = value !== null ? 1 : 0;
  const totalItems = clearOffset + results.length;
  const trimmedSearch = search.trim();
  const showPrompt = trimmedSearch.length < 2 && !loading;

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
          setFocusedIndex(0);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        selectAndClose();
        setFocusedIndex(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < totalItems - 1 ? prev + 1 : 0;
          itemRefs.current[next]?.focus();
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : totalItems - 1;
          itemRefs.current[next]?.focus();
          return next;
        });
      }
    },
    [open, toggle, selectAndClose, totalItems],
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        selectAndClose();
        setFocusedIndex(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < totalItems - 1 ? prev + 1 : 0;
          itemRefs.current[next]?.focus();
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : totalItems - 1;
          itemRefs.current[next]?.focus();
          return next;
        });
      }
    },
    [selectAndClose, totalItems],
  );

  return (
    <div className="relative">
      <Button
        variant="outline"
        type="button"
        className="w-full justify-between text-left font-normal"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="user-list"
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className={`min-w-0 truncate ${value && selectedUser ? "" : "text-muted-foreground"}`}
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
        <div
          id="user-list"
          role="listbox"
          tabIndex={0}
          aria-activedescendant={
            focusedIndex >= 0 ? `user-option-${focusedIndex}` : undefined
          }
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md"
          onKeyDown={handleListKeyDown}
        >
          <div className="p-2">
            <Input
              aria-label="Search users"
              placeholder="Type to search..."
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
                    id="user-option-0"
                    role="option"
                    aria-selected={false}
                    ref={(el) => {
                      itemRefs.current[0] = el;
                    }}
                    type="button"
                    className="relative flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-hidden select-none hover:bg-accent"
                    onClick={() => {
                      onChange(null);
                      setSelectedUser(null);
                      selectAndClose();
                    }}
                  >
                    Clear selection
                  </button>
                )}
                {showPrompt ? (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                    Type at least 2 characters to search.
                  </p>
                ) : results.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                    No users found.
                  </p>
                ) : null}
                {results.map((user: UserListItem, idx: number) => (
                  <button
                    key={user.id}
                    id={`user-option-${clearOffset + idx}`}
                    role="option"
                    aria-selected={user.id === value}
                    ref={(el) => {
                      itemRefs.current[clearOffset + idx] = el;
                    }}
                    type="button"
                    className={`relative flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent ${
                      user.id === value ? "bg-accent font-medium" : ""
                    }${user.status !== "active" ? "opacity-50" : ""}`}
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
                ))}
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
