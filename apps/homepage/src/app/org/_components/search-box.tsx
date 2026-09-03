"use client";

import { useEffect, useRef, useState } from "react";
import type { Org } from "../_lib/types";

interface SearchBoxProps {
  onSelect: (org: Org) => void;
  getResults: (query: string) => Org[];
  disabled?: boolean;
}

export function SearchBox({ onSelect, getResults, disabled }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Org[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    const hits = getResults(query);
    setResults(hits);
    setOpen(hits.length > 0);
  }, [query, getResults]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results.length > 0) {
      const first = results[0]!;
      setQuery(first.name);
      setOpen(false);
      onSelect(first);
    }
    if (e.key === "Escape") {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleSelect(org: Org) {
    setQuery(org.name);
    setOpen(false);
    onSelect(org);
  }

  return (
    <div ref={containerRef} className="relative">
      <label
        htmlFor="org-search"
        className="mb-1 block text-xs tracking-widest text-muted-foreground uppercase"
      >
        Search
      </label>
      <input
        id="org-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => query.trim() && setOpen(results.length > 0)}
        placeholder="Sectors, areas, regions…"
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted disabled:text-muted-foreground"
      />
      {open && (
        <div
          role="listbox"
          className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg"
        >
          {results.map((org) => (
            <button
              key={org.id}
              role="option"
              aria-selected={false}
              type="button"
              onClick={() => handleSelect(org)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition hover:-translate-y-px hover:border-primary/50 hover:shadow-md"
            >
              <span className="font-semibold text-foreground">{org.name}</span>
              <span className="ml-2 text-xs tracking-widest text-muted-foreground uppercase">
                {org.orgType}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && results.length === 0 && (
        <div className="absolute top-full z-20 mt-1 w-full rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground shadow-lg">
          No matches
        </div>
      )}
    </div>
  );
}
