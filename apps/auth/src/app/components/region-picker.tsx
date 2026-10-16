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
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
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

  function clearBlurTimeout() {
    if (blurTimeoutRef.current !== null) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }

  function choose(r: Region) {
    // A blur still waiting to run would act on the old value.
    clearBlurTimeout();
    selectedRef.current = false;
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
        onFocus={() => {
          clearBlurTimeout();
          setDropdownOpen(true);
        }}
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
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => {
            blurTimeoutRef.current = null;
            if (!selectedRef.current) {
              if (valueRef.current) {
                // Restore the selected region name if user didn't change selection
                const selected = regions.find((r) => r.id === valueRef.current);
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
            // Keyboard users pick through the input (arrow keys + Enter), the
            // standard combobox pattern, so options aren't focusable.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={r.id}
              id={`homeRegion-option-${r.id}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => {
                selectedRef.current = true;
              }}
              onClick={() => choose(r)}
              className={`cursor-pointer px-4 py-2 text-left text-base transition-colors hover:bg-accent ${
                i === activeIndex ? "bg-accent" : ""
              }`}
            >
              {r.name}
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
