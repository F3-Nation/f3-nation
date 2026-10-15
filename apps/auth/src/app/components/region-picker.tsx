"use client";

import { useEffect, useRef, useState } from "react";

export interface Region {
  id: number;
  name: string;
}

interface RegionPickerProps {
  regions: Region[];
  /** The chosen region's id, or "" while nothing is chosen. */
  value: number | "";
  onChange: (id: number | "") => void;
  /** The text typed into the box. Controlled so a caller can persist it. */
  search: string;
  onSearchChange: (search: string) => void;
  inputClass: string;
  placeholder: string;
  required?: boolean;
}

/** Type-ahead picker for a home region, shared by sign-up and onboarding. */
export function RegionPicker({
  regions,
  value,
  onChange,
  search,
  onSearchChange,
  inputClass,
  placeholder,
  required,
}: RegionPickerProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(false);

  // Close region dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredRegions = regions.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor="homeRegion" className="mb-2 block text-base font-medium">
        Home Region
      </label>
      <input
        id="homeRegion"
        type="text"
        required={required}
        value={search}
        onChange={(e) => {
          onSearchChange(e.target.value);
          onChange("");
          setDropdownOpen(true);
        }}
        onFocus={() => setDropdownOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            if (!selectedRef.current) {
              if (value) {
                // Restore the selected region name if user didn't change selection
                const selected = regions.find((r) => r.id === value);
                if (selected) {
                  onSearchChange(selected.name);
                }
              } else {
                onSearchChange("");
              }
            }
            selectedRef.current = false;
            setDropdownOpen(false);
          }, 200);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {dropdownOpen && filteredRegions.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-card shadow-lg">
          {filteredRegions.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={() => {
                  selectedRef.current = true;
                }}
                onClick={() => {
                  onChange(r.id);
                  onSearchChange(r.name);
                  setDropdownOpen(false);
                }}
                className="w-full px-4 py-2 text-left text-base transition-colors hover:bg-accent"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dropdownOpen && search && filteredRegions.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-card px-4 py-3 text-base text-muted-foreground shadow-lg">
          No regions found
        </div>
      )}
    </div>
  );
}
