"use client";

import dayjs from "dayjs";
import { CalendarRange, ChevronsUpDown } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";

export interface DateRange {
  from: string;
  to: string;
}

export const EMPTY_DATE_RANGE: DateRange = { from: "", to: "" };

export const todayForwardDateRange = (): DateRange => ({
  from: dayjs().format("YYYY-MM-DD"),
  to: "",
});

const formatBound = (value: string) => (value.length > 0 ? value : "…");

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
  const id = useId();
  const fromId = `${id}-from`;
  const toId = `${id}-to`;
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
              <Label htmlFor={fromId}>From</Label>
              <Input
                id={fromId}
                type="date"
                value={value.from}
                // `max`/`min` keep the two inputs from crossing, which would
                // silently return zero rows.
                max={value.to.length > 0 ? value.to : undefined}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={toId}>To</Label>
              <Input
                id={toId}
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
