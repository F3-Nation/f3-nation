import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@acme/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";

import type { RouterOutputs } from "~/trpc/types";
import { api } from "~/trpc/react";

type Area = RouterOutputs["org"]["all"]["orgs"][number];
type Sector = RouterOutputs["org"]["all"]["orgs"][number];

export const AreaFilter = ({
  onAreaSelect,
  selectedAreas,
  selectedSectors,
}: {
  onAreaSelect: (area: Area) => void;
  selectedAreas: Area[];
  selectedSectors?: Sector[];
}) => {
  const { data: areas } = api.org.all.useQuery({ orgTypes: ["area"] });
  const [open, setOpen] = useState(false);

  const availableAreas = useMemo(() => {
    return areas?.orgs.filter((area) => {
      return (
        !selectedSectors?.length ||
        selectedSectors.some((sector) => sector.id === area.parentId)
      );
    });
  }, [areas, selectedSectors]);

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
            {selectedAreas.length > 0
              ? `${selectedAreas.length} area${selectedAreas.length > 1 ? "s" : ""} selected`
              : "Filter by area"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search statuses..." />
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup>
              {availableAreas?.map((area) => (
                <CommandItem
                  key={area.id}
                  value={area.name}
                  onSelect={() => {
                    onAreaSelect(area);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedAreas.includes(area)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {area.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
