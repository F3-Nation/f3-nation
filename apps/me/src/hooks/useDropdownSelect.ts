import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDropdownSelectReturn {
  open: boolean;
  search: string;
  toggle: () => void;
  close: () => void;
  setSearch: (value: string) => void;
  /** Reset search and close the dropdown. */
  selectAndClose: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Shared dropdown open/close + search state for select-style components.
 * Keeps the RegionSelect and UserSelect DRY.
 */
export function useDropdownSelect(): UseDropdownSelectReturn {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const selectAndClose = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  return { open, search, toggle, close, setSearch, selectAndClose };
}
