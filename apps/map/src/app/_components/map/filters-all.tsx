"use client";

import type { ComponentProps } from "react";
import { useMemo } from "react";

import { X } from "lucide-react";

import { SHORT_DAY_ORDER } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { useTheme } from "@acme/ui/theme";

import { orpc, useQuery } from "~/orpc/react";
import type { FiltersType } from "~/utils/store/filter";
import {
  filterStore,
  initialFilterState,
  TimeSelection,
} from "~/utils/store/filter";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

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

// The main component for the map drawer.
export const FiltersAll = (props: ComponentProps<"div">) => {
  RERENDER_LOGS && console.log("DrawerAllFilters rerender");
  const { className, ...rest } = props;
  const filters = filterStore.useBoundStore();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { data: nationalEventTypesResult, isLoading } = useQuery(
    orpc.eventType.all.queryOptions({
      input: {
        nationalOnly: true,
        statuses: ["active"],
        sorting: [{ id: "name", desc: false }],
      },
    }),
  );
  const nationalEventTypes = nationalEventTypesResult?.eventTypes;

  const eventTypeOptions = useMemo(
    () =>
      nationalEventTypes?.map((et) => ({
        value: String(et.id),
        label: et.name,
      })) ?? [],
    [nationalEventTypes],
  );

  const selectedIds = filters.nationalEventTypeIds;

  // Function to toggle the state of a filter when clicked.
  const handleFilterClick = (
    filterName: keyof FiltersType,
    newState?: boolean,
  ) => {
    if (filterName === "allFilters") {
      filterStore.setState((s) => ({ allFilters: !s.allFilters }));
    } else {
      filterStore.setState((s) => ({
        [filterName]: newState ?? !s[filterName],
      }));
    }
  };

  const handleResetFilters = () => {
    filterStore.setState(initialFilterState);
  };

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center overflow-scroll",
        className,
      )}
      {...rest}
    >
      <div className="mt-4 flex h-full flex-col gap-4 overflow-auto px-6 pb-20 ">
        <div className="flex flex-row justify-between">
          <h2 className="text-center text-xl font-bold">Map Filters</h2>
          <button
            className="pointer-events-auto"
            onClick={() => handleFilterClick("allFilters")}
          >
            <div className="rounded-full border-[1px] border-black">
              <X />
            </div>
          </button>
        </div>
        <div>
          <h3 className="mb-2 mt-2 text-lg font-semibold">Day of Workout</h3>
          <div className="grid grid-cols-7 gap-2">
            {SHORT_DAY_ORDER.map((day, index) => (
              <button
                key={index}
                className={cn(
                  {
                    "border-blue-500 bg-blue-100 text-blue-500 dark:bg-blue-900 dark:text-blue-300":
                      filters[`day${day}`],
                    "border-gray-300 bg-background text-gray-500 dark:border-gray-700 dark:text-gray-400":
                      !filters[`day${day}`],
                  },
                  `rounded-lg border px-2 py-1`,
                )}
                onClick={() => handleFilterClick(`day${day}`)}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Time of Workout</h2>
          <div className="flex items-center gap-4">
            <Select
              value={filters.beforeAfterDirection}
              onValueChange={(v) =>
                filterStore.setState({
                  beforeAfterDirection: v as "before" | "after",
                })
              }
            >
              <SelectTrigger data-vaul-no-drag className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">On or before</SelectItem>
                <SelectItem value="after">On or after</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.beforeAfterTime}
              onValueChange={(v) =>
                filterStore.setState({
                  beforeAfterTime: v as TimeSelection,
                })
              }
            >
              <SelectTrigger
                data-vaul-no-drag
                className={cn(
                  "w-40",
                  filters.beforeAfterTime !== TimeSelection.none &&
                    "border-blue-500 bg-blue-100",
                )}
              >
                <SelectValue placeholder="--" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TimeSelection.none}>--</SelectItem>
                {TIME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Type of Workout</h2>
          <div className="w-full max-w-sm" data-vaul-no-drag>
            <VirtualizedCombobox
              disabled={isLoading}
              isMulti
              options={eventTypeOptions}
              popoverContentAlign="start"
              searchPlaceholder="All types"
              value={selectedIds.map(String)}
              className={cn(
                "w-full",
                selectedIds.length > 0 &&
                  (isDark
                    ? "border-blue-500 bg-blue-950"
                    : "border-blue-500 bg-blue-100"),
              )}
              onSelect={(item) => {
                const ids = Array.isArray(item)
                  ? item.map((id) => Number(id))
                  : [Number(item)];
                filterStore.setState({ nationalEventTypeIds: ids });
              }}
            />
          </div>
          {nationalEventTypes?.length === 0 && !isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No national event types found.
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-row items-center justify-center gap-4">
          <Button
            className="w-32 justify-self-center bg-gray-500 text-white hover:bg-gray-300"
            onClick={handleResetFilters}
          >
            Reset
          </Button>
          <Button
            className="w-32 justify-self-center bg-blue-500 text-white hover:bg-blue-300"
            onClick={() => handleFilterClick("allFilters")}
          >
            <span className="text-white">Apply</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
