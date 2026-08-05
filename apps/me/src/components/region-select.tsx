"use client";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";

import { useDropdownSelect } from "@/hooks/useDropdownSelect";
import { useRegionFilter } from "@/hooks/useRegionFilter";
import type { Region } from "@/lib/types";

interface RegionSelectProps {
  regions: Region[];
  value: number | null;
  onChange: (regionId: number | null) => void;
}

export function RegionSelect({ regions, value, onChange }: RegionSelectProps) {
  const { open, search, toggle, close, setSearch, selectAndClose } =
    useDropdownSelect();
  const { selectedRegion, filteredRegions } = useRegionFilter({
    regions,
    selectedId: value,
    search,
  });

  return (
    <div className="relative">
      <Button
        variant="outline"
        type="button"
        className="w-full justify-between text-left font-normal"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls="region-list"
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
        <div
          id="region-list"
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md"
        >
          <div className="p-2">
            <Input
              aria-label="Search regions"
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
                className="relative flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-hidden select-none hover:bg-accent"
                onClick={() => {
                  onChange(null);
                  selectAndClose();
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
                  disabled={!region.isActive && region.id !== value}
                  className={`relative flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent ${
                    region.id === value ? "bg-accent font-medium" : ""
                  }${!region.isActive ? "opacity-50" : ""}`}
                  onClick={() => {
                    onChange(region.id);
                    selectAndClose();
                  }}
                >
                  {region.name}
                  {!region.isActive && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Inactive
                    </span>
                  )}
                </button>
              ))
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
