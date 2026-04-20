"use client";

import { Check, Filter, X } from "lucide-react";
import { useState } from "react";

import type { IsActiveStatus } from "@acme/shared/app/enums";
import { IsActiveStatus as IsActiveStatusEnum } from "@acme/shared/app/enums";
import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@acme/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";

export const StatusFilter = ({
  selectedStatuses,
  setSelectedStatuses,
  onlyMine,
  setOnlyMine,
  resetPage,
}: {
  selectedStatuses: IsActiveStatus[];
  setSelectedStatuses: (statuses: IsActiveStatus[]) => void;
  onlyMine: boolean;
  setOnlyMine: (value: boolean) => void;
  resetPage: () => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-row gap-2">
      {/* Status badges */}
      <div className="flex flex-wrap gap-1">
        {selectedStatuses.includes("active") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-green-100 px-2 py-1 text-green-700 hover:bg-green-200",
            )}
            onClick={() => {
              setSelectedStatuses(
                selectedStatuses.filter((s) => s !== "active"),
              );
              resetPage();
            }}
          >
            Active
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {selectedStatuses.includes("inactive") && (
          <Badge
            className={cn(
              "flex items-center gap-1 rounded-full border-transparent bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200",
            )}
            onClick={() => {
              setSelectedStatuses(
                selectedStatuses.filter((s) => s !== "inactive"),
              );
              resetPage();
            }}
          >
            Inactive
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
        {onlyMine && (
          <Badge
            className="flex items-center gap-1 rounded-full border-transparent bg-blue-100 px-2 py-1 text-blue-700 hover:bg-blue-200"
            onClick={() => {
              setOnlyMine(false);
              resetPage();
            }}
          >
            Only Mine
            <X className="h-3.5 w-3.5 cursor-pointer" />
          </Badge>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            aria-expanded={open}
            className="flex size-8 items-center justify-center rounded-full bg-muted shadow-md hover:bg-background/80"
          >
            <Filter className="size-5 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search statuses..." />
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup>
              {IsActiveStatusEnum.map((status) => (
                <CommandItem
                  key={status}
                  value={status}
                  onSelect={() => {
                    const newStatuses = selectedStatuses.includes(status)
                      ? selectedStatuses.filter((s) => s !== status)
                      : [...selectedStatuses, status];
                    setSelectedStatuses(newStatuses);
                    resetPage();
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedStatuses.includes(status)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </CommandItem>
              ))}
              <CommandItem
                onSelect={() => {
                  setOnlyMine(!onlyMine);
                  resetPage();
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    onlyMine ? "opacity-100" : "opacity-0",
                  )}
                />
                Only Mine
              </CommandItem>
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
