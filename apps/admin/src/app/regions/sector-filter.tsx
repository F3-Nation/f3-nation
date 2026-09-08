import { useState } from "react";
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

import type { RouterOutputs } from "~/orpc/types";
import { isOrgSelected } from "./org-ancestry";

type Sector = RouterOutputs["org"]["all"]["orgs"][number];

export const SectorFilter = ({
  onSectorSelect,
  selectedSectors,
  sectors,
}: {
  onSectorSelect: (sector: Sector) => void;
  selectedSectors: Sector[];
  sectors: Sector[] | undefined;
}) => {
  const [open, setOpen] = useState(false);

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
            {selectedSectors.length > 0
              ? `${selectedSectors.length} sector${selectedSectors.length > 1 ? "s" : ""} selected`
              : "Filter by sector"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search sectors..." />
            <CommandEmpty>No sectors found.</CommandEmpty>
            <CommandGroup className="max-h-96 overflow-y-auto">
              {sectors?.map((sector) => (
                <CommandItem
                  key={sector.id}
                  value={sector.name}
                  onSelect={() => {
                    onSectorSelect(sector);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      isOrgSelected(selectedSectors, sector)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {sector.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
