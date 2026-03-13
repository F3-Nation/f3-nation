"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Region } from "@/lib/types";

interface RegionSelectProps {
  regions: Region[];
  value: number | null;
  onChange: (regionId: number | null) => void;
}

export function RegionSelect({ regions, value, onChange }: RegionSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedRegion = useMemo(
    () => regions.find((r) => r.id === value),
    [regions, value],
  );

  const filteredRegions = useMemo(() => {
    if (!search) return regions;
    const lower = search.toLowerCase();
    return regions.filter((r) => r.name.toLowerCase().includes(lower));
  }, [regions, search]);

  return (
    <div className="relative">
      <Button
        variant="outline"
        type="button"
        className="w-full justify-between text-left font-normal"
        onClick={() => setOpen(!open)}
      >
        <span className={selectedRegion ? "" : "text-muted-foreground"}>
          {selectedRegion?.name ?? "Select a region..."}
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
              placeholder="Search regions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {value !== null && (
              <button
                type="button"
                className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setSearch("");
                }}
              >
                Clear selection
              </button>
            )}
            {filteredRegions.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                No regions found.
              </p>
            ) : (
              filteredRegions.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  className={`relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent ${
                    region.id === value ? "bg-accent font-medium" : ""
                  }`}
                  onClick={() => {
                    onChange(region.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  {region.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Click-away handler */}
      {open && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setOpen(false);
            setSearch("");
          }}
        />
      )}
    </div>
  );
}
