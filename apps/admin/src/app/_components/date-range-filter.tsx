"use client";

import { CalendarRange, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";

export interface DateRange {
  /** Inclusive lower bound, YYYY-MM-DD. Empty string means unbounded. */
  from: string;
  /** Inclusive upper bound, YYYY-MM-DD. Empty string means unbounded. */
  to: string;
}

export const EMPTY_DATE_RANGE: DateRange = { from: "", to: "" };

const formatBound = (value: string) =>
  // The value is already YYYY-MM-DD; showing it verbatim keeps the trigger
  // unambiguous across locales and avoids a timezone shift from parsing it
  // into a Date only to print it again.
  value.length > 0 ? value : "…";

/**
 * Filters a date column to an inclusive range. Either bound can stand alone,
 * so "everything from today onward" and "everything before March" both work.
 */
export const DateRangeFilter = ({
  value,
  onChange,
  label = "Filter by date",
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  label?: string;
}) => {
  const [open, setOpen] = useState(false);
  const hasRange = value.from.length > 0 || value.to.length > 0;

  return (
    <div className="max-w-80">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="flex items-center gap-2 truncate">
              <CalendarRange className="h-4 w-4 shrink-0 opacity-50" />
              {hasRange
                ? `${formatBound(value.from)} → ${formatBound(value.to)}`
                : label}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="date-range-from">From</Label>
              <Input
                id="date-range-from"
                type="date"
                value={value.from}
                // `max`/`min` keep the two inputs from crossing, which would
                // silently return zero rows.
                max={value.to.length > 0 ? value.to : undefined}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="date-range-to">To</Label>
              <Input
                id="date-range-to"
                type="date"
                value={value.to}
                min={value.from.length > 0 ? value.from : undefined}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              className="w-full bg-muted hover:bg-muted/80"
              disabled={!hasRange}
              onClick={() => onChange(EMPTY_DATE_RANGE)}
            >
              Clear dates
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
