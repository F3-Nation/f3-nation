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
import { orpc, useQuery } from "~/orpc/react";

type Sector = RouterOutputs["org"]["all"]["orgs"][number];

export const SectorFilter = ({
  onSectorSelect,
  selectedSectors,
}: {
  onSectorSelect: (sector: Sector) => void;
  selectedSectors: Sector[];
}) => {
  const { data: sectors } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["sector"] } }),
  );
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
            <CommandInput placeholder="Search statuses..." />
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup>
              {sectors?.orgs.map((sector) => (
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
                      selectedSectors.includes(sector)
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
