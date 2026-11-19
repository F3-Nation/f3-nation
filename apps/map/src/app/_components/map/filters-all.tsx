"use client";

import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import { X } from "lucide-react";

import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";

import { client } from "~/orpc/client";
import { STRIP_DAYS } from "~/utils/ao-schedule-summary";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import {
  filterStore,
  initialFilterState,
  TimeSelection,
  useTodayAndTomorrowFilters,
} from "~/utils/store/filter";
import { useFilteredMapResults } from "./filtered-map-results-provider";

const TIME_OPTIONS = Object.values(TimeSelection)
  .filter((v) => v !== TimeSelection.none)
  .map((value) => {
    const match = /^(\d{1,2})(am|pm)$/.exec(value);
    return {
      value,
      label:
        match?.[1] && match[2]
          ? `${match[1]} ${match[2].toUpperCase()}`
          : value,
    };
  });

const DAY_KEYS = [
  "daySu",
  "dayM",
  "dayTu",
  "dayW",
  "dayTh",
  "dayF",
  "daySa",
] as const;

/** A toggle chip; `aria-pressed` carries its state for assistive tech and tests. */
const Chip = ({
  pressed,
  className,
  ...rest
}: ComponentProps<"button"> & { pressed: boolean }) => (
  <button
    type="button"
    aria-pressed={pressed}
    className={cn(
      "h-8 rounded-full border px-3 text-xs font-bold whitespace-nowrap transition-colors",
      pressed
        ? "border-primary bg-primary text-primary-foreground"
        : "border-input bg-background text-foreground hover:bg-muted",
      className,
    )}
    {...rest}
  />
);

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <h3 className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
      {label}
    </h3>
    {children}
  </div>
);

/**
 * The map's filters. Inline under the Filters button in the left panel, and
 * full screen on the mobile layout.
 */
export const FiltersAll = ({
  className,
  variant = "inline",
  ...rest
}: ComponentProps<"div"> & { variant?: "inline" | "screen" }) => {
  RERENDER_LOGS && console.log("FiltersAll rerender");
  const filters = filterStore.useBoundStore();
  const { today, tomorrow, todayVar, tomorrowVar } =
    useTodayAndTomorrowFilters();
  const { filteredLocationMarkers } = useFilteredMapResults();

  const { data: nationalEventTypes, isLoading } = useFetchAllPages({
    path: ["eventType", "all"],
    queryKey: ["eventType.all.everyNational"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { eventTypes: items, totalCount } = await client.eventType.all({
        nationalOnly: true,
        statuses: ["active"],
        sorting: [{ id: "name", desc: false }],
        pageIndex,
        pageSize,
      });
      return { items, total: totalCount };
    },
  });

  const workoutCount = useMemo(
    () =>
      filteredLocationMarkers?.reduce((sum, m) => sum + m.events.length, 0) ??
      null,
    [filteredLocationMarkers],
  );

  const close = () => filterStore.setState({ allFilters: false });
  const timeOfDay = filters.am ? "am" : filters.pm ? "pm" : "any";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 text-foreground",
        variant === "inline"
          ? "rounded-md border bg-card p-4"
          : "h-full overflow-y-auto px-6 pt-6 pb-24",
        className,
      )}
      {...rest}
    >
      {variant === "screen" ? (
        <div className="flex flex-row items-center justify-between">
          <h2 className="text-lg font-extrabold uppercase">Filters</h2>
          <button
            type="button"
            aria-label="Close filters"
            className="rounded-full border p-1"
            onClick={close}
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
      ) : null}

      <Group label="Quick pick">
        <div className="flex flex-row flex-wrap gap-2">
          <Chip
            pressed={today}
            onClick={() =>
              filterStore.setState((s) => ({ [todayVar]: !s[todayVar] }))
            }
          >
            Today
          </Chip>
          <Chip
            pressed={tomorrow}
            onClick={() =>
              filterStore.setState((s) => ({ [tomorrowVar]: !s[tomorrowVar] }))
            }
          >
            Tomorrow
          </Chip>
          <Chip
            pressed={filters.weekend}
            onClick={() =>
              filterStore.setState((s) => ({ weekend: !s.weekend }))
            }
          >
            This weekend
          </Chip>
        </div>
      </Group>

      <Group label="Day">
        <div className="grid grid-cols-7 gap-1">
          {STRIP_DAYS.map((day, index) => {
            const key = DAY_KEYS[index] ?? "daySu";
            return (
              <button
                key={day.day}
                type="button"
                aria-label={day.long}
                aria-pressed={filters[key]}
                onClick={() =>
                  filterStore.setState((s) => ({ [key]: !s[key] }))
                }
                className={cn(
                  "flex h-9 items-center justify-center rounded-sm border text-xs font-bold transition-colors",
                  filters[key]
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:bg-muted",
                )}
              >
                {day.letter}
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Time">
        <div className="flex flex-row flex-wrap gap-2">
          <Chip
            pressed={timeOfDay === "any"}
            onClick={() => filterStore.setState({ am: false, pm: false })}
          >
            Any time
          </Chip>
          <Chip
            pressed={timeOfDay === "am"}
            onClick={() => filterStore.setState({ am: true, pm: false })}
          >
            Morning
          </Chip>
          <Chip
            pressed={timeOfDay === "pm"}
            onClick={() => filterStore.setState({ am: false, pm: true })}
          >
            Evening
          </Chip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            <span aria-hidden>Starts</span>
            <Select
              value={filters.beforeAfterDirection}
              onValueChange={(v) =>
                filterStore.setState({
                  beforeAfterDirection: v as "before" | "after",
                })
              }
            >
              <SelectTrigger aria-label="Starts" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">On or before</SelectItem>
                <SelectItem value="after">On or after</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            <span aria-hidden>Time</span>
            <Select
              value={filters.beforeAfterTime}
              onValueChange={(v) =>
                filterStore.setState({ beforeAfterTime: v as TimeSelection })
              }
            >
              <SelectTrigger
                aria-label="Start time"
                className={cn("h-9 text-xs", {
                  "border-primary":
                    filters.beforeAfterTime !== TimeSelection.none,
                })}
              >
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TimeSelection.none}>Any</SelectItem>
                {TIME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Group>

      <Group label="Type">
        <div className="flex flex-row flex-wrap gap-2">
          {isLoading ? (
            <span className="text-xs text-muted-foreground">
              Loading types…
            </span>
          ) : null}
          {nationalEventTypes?.map((type) => {
            const pressed = filters.nationalEventTypeIds.includes(type.id);
            return (
              <Chip
                key={type.id}
                pressed={pressed}
                onClick={() =>
                  filterStore.setState((s) => ({
                    nationalEventTypeIds: pressed
                      ? s.nationalEventTypeIds.filter((id) => id !== type.id)
                      : [...s.nationalEventTypeIds, type.id],
                  }))
                }
              >
                {type.name}
              </Chip>
            );
          })}
          {nationalEventTypes?.length === 0 && !isLoading ? (
            <p className="text-xs text-muted-foreground">
              No national event types found.
            </p>
          ) : null}
        </div>
      </Group>

      <div className="flex flex-row items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => filterStore.setState(initialFilterState)}
          className="h-10 rounded-full border border-input px-5 text-xs font-bold tracking-wider uppercase hover:bg-muted"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={close}
          className="hover:bg-primary-hover h-10 flex-1 rounded-full bg-primary px-4 text-xs font-bold tracking-wider text-primary-foreground uppercase"
        >
          {workoutCount == null
            ? "Show workouts"
            : `Show ${workoutCount} workout${workoutCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
};
