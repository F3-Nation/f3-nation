"use client";

import { useEffect, useRef, useState } from "react";
import type { AoSearchResult, Org } from "../_lib/types";
import { useAoSearch } from "../_lib/use-ao-search";

interface SearchBoxProps {
  onSelect: (org: Org) => void;
  getResults: (query: string) => Org[];
  onSelectAo: (ao: AoSearchResult) => boolean;
  disabled?: boolean;
}

export function SearchBox({
  onSelect,
  getResults,
  onSelectAo,
  disabled,
}: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Org[]>([]);
  const [open, setOpen] = useState(false);
  const [aoNavigateFailed, setAoNavigateFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Set when a result is chosen: the resulting setQuery(name) must not reopen
  // the list on the next effect run.
  const justSelectedRef = useRef(false);

  // AOs aren't in the client dataset (the chart loads regions), so they're
  // searched server-side (debounced). Only query while the list is open so a
  // selection — which sets the query to the chosen name — doesn't refetch.
  const {
    results: aoResults,
    loading: aoLoading,
    error: aoError,
  } = useAoSearch(open ? query : "");

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      setAoNavigateFailed(false);
      return;
    }
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      // Refresh results to the full-name query so a later focus doesn't reopen
      // a stale partial-query list, but keep the list closed for now. Leave
      // aoNavigateFailed as-is: this same query change is what handleSelectAo
      // just used to report its outcome, and resetting here would erase it.
      setResults(getResults(query));
      setOpen(false);
      return;
    }
    setAoNavigateFailed(false);
    const hits = getResults(query);
    setResults(hits);
    setOpen(true);
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
    if (e.key === "Enter") {
      // Prefer an org match; fall back to the first AO hit.
      if (results.length > 0) {
        handleSelect(results[0]!);
      } else if (aoResults.length > 0) {
        handleSelectAo(aoResults[0]!);
      }
    }
    if (e.key === "Escape") {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleSelect(org: Org) {
    justSelectedRef.current = true;
    setAoNavigateFailed(false);
    setQuery(org.name);
    setOpen(false);
    onSelect(org);
  }

  function handleSelectAo(ao: AoSearchResult) {
    justSelectedRef.current = true;
    setQuery(ao.name ?? "");
    setOpen(false);
    setAoNavigateFailed(!onSelectAo(ao));
  }

  const showAoSearchError =
    open && aoError && results.length === 0 && aoResults.length === 0;

  const showEmpty =
    open &&
    results.length === 0 &&
    aoResults.length === 0 &&
    !aoLoading &&
    !aoError;

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
        onFocus={() => query.trim() && setOpen(true)}
        placeholder="Sectors, areas, regions, AOs…"
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted disabled:text-muted-foreground"
      />
      {open && (results.length > 0 || aoResults.length > 0 || aoLoading) && (
        <div
          role="listbox"
          className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg"
        >
          {results.map((org) => (
            <button
              key={`org-${org.id}`}
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
          {aoResults.map((ao) => (
            <button
              key={`ao-${ao.id}`}
              role="option"
              aria-selected={false}
              type="button"
              onClick={() => handleSelectAo(ao)}
              className="mt-1 flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition hover:-translate-y-px hover:border-primary/50 hover:shadow-md"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-foreground">
                  {ao.name ?? "Unnamed AO"}
                </span>
                {ao.regionName && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {ao.regionName}
                  </span>
                )}
              </span>
              <span className="ml-2 text-xs tracking-widest text-muted-foreground uppercase">
                AO
              </span>
            </button>
          ))}
          {aoLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Searching AOs…
            </div>
          )}
        </div>
      )}
      {showAoSearchError && (
        <div className="absolute top-full z-20 mt-1 w-full rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground shadow-lg">
          Search unavailable — try again
        </div>
      )}
      {showEmpty && (
        <div className="absolute top-full z-20 mt-1 w-full rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground shadow-lg">
          No matches
        </div>
      )}
      {aoNavigateFailed && (
        <div className="absolute top-full z-20 mt-1 w-full rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground shadow-lg">
          Couldn't locate that AO on the map
        </div>
      )}
    </div>
  );
}
