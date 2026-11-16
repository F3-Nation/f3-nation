"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Org } from "../_lib/types";
import { fuzzyScore } from "../_lib/geo-utils";

interface FilterMultiSelectProps {
  label: string;
  options: Org[];
  selectedIds: readonly number[];
  onToggle: (orgId: number) => void;
  onClear: () => void;
}

/** A filter dropdown with a search box and one checkbox per option. */
export function FilterMultiSelect({
  label,
  options,
  selectedIds,
  onToggle,
  onClear,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();

  function close() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close();
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const selected = new Set(selectedIds);
  const visible = query.trim()
    ? options.filter((o) => fuzzyScore(query, o.name) != null)
    : options;

  const firstSelected = options.find((o) => selected.has(o.id));
  const summary =
    selectedIds.length === 0
      ? "All"
      : selectedIds.length === 1 && firstSelected
        ? firstSelected.name
        : `${selectedIds.length} selected`;

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-col sm:w-48">
      <span
        id={`${id}-label`}
        className="mb-1 text-xs tracking-widest text-muted-foreground uppercase"
      >
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-2 py-2 text-left text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 [@media(any-pointer:coarse)]:text-base"
      >
        <span id={`${id}-value`} className="truncate">
          {summary}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} filter`}
          className="absolute top-full z-30 mt-1 w-full min-w-56 rounded-xl border border-border bg-card p-2 shadow-lg"
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label}`}
            autoComplete="off"
            className="mb-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 [@media(any-pointer:coarse)]:text-base"
          />
          <ul className="max-h-60 overflow-y-auto">
            {visible.map((org) => (
              <li key={org.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selected.has(org.id)}
                    onChange={() => onToggle(org.id)}
                  />
                  <span className="truncate">{org.name}</span>
                </label>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                No matches
              </li>
            )}
          </ul>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs font-medium text-primary hover:bg-muted"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
