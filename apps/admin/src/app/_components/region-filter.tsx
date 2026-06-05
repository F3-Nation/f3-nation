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

type Region = RouterOutputs["org"]["all"]["orgs"][number];

export const RegionFilter = ({
  onRegionSelect,
  selectedRegions,
}: {
  onRegionSelect: (region: Region) => void;
  selectedRegions: Region[];
}) => {
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
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
            {selectedRegions.length > 0
              ? `${selectedRegions.length} region${selectedRegions.length > 1 ? "s" : ""} selected`
              : "Filter by region"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search regions..." />
            <CommandEmpty>No regions found.</CommandEmpty>
            <CommandGroup className="max-h-96 overflow-y-auto">
              {regions?.orgs.map((region) => (
                <CommandItem
                  key={region.id}
                  value={region.name}
                  onSelect={() => {
                    onRegionSelect(region);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedRegions.includes(region)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {region.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
