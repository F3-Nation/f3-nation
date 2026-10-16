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
  const [activeIndex, setActiveIndex] = useState(-1);

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

  function choose(r: Region) {
    onChange(r.id);
    onSearchChange(r.name);
    setDropdownOpen(false);
    setActiveIndex(-1);
  }

  const listOpen = dropdownOpen && filteredRegions.length > 0;

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
          setActiveIndex(-1);
        }}
        onFocus={() => setDropdownOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (filteredRegions.length === 0) return;
            e.preventDefault();
            setDropdownOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            const last = filteredRegions.length - 1;
            setActiveIndex(
              activeIndex < 0
                ? step === 1
                  ? 0
                  : last
                : (activeIndex + step + filteredRegions.length) %
                    filteredRegions.length,
            );
          } else if (e.key === "Enter" && listOpen) {
            // Pick instead of submitting the form.
            e.preventDefault();
            const pick =
              filteredRegions[activeIndex] ??
              (filteredRegions.length === 1 ? filteredRegions[0] : undefined);
            if (pick) choose(pick);
          } else if (e.key === "Escape" && dropdownOpen) {
            setDropdownOpen(false);
            setActiveIndex(-1);
          }
        }}
        onBlur={(e) => {
          // Focus moving into the list (Tab to an option) is not leaving.
          if (containerRef.current?.contains(e.relatedTarget)) return;
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
            setActiveIndex(-1);
          }, 200);
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls="homeRegion-listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          listOpen && activeIndex >= 0
            ? `homeRegion-option-${filteredRegions[activeIndex]?.id}`
            : undefined
        }
        className={inputClass}
      />
      {listOpen && (
        <ul
          id="homeRegion-listbox"
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-card shadow-lg"
        >
          {filteredRegions.map((r, i) => (
            <li
              key={r.id}
              id={`homeRegion-option-${r.id}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={() => {
                  selectedRef.current = true;
                }}
                onClick={() => choose(r)}
                className={`w-full px-4 py-2 text-left text-base transition-colors hover:bg-accent ${
                  i === activeIndex ? "bg-accent" : ""
                }`}
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
