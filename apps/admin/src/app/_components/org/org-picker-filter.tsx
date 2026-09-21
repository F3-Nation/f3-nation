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
import type { OrgType } from "@acme/shared/app/enums";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";

import { isOrgSelected } from "./org-ancestry";

export const OrgPickerFilter = <T extends { id: number; name: string }>({
  orgType,
  orgs,
  selected,
  onSelect,
}: {
  orgType: OrgType;
  orgs: T[] | undefined;
  selected: T[];
  onSelect: (org: T) => void;
}) => {
  const [open, setOpen] = useState(false);
  const singular = orgTypeDisplay[orgType].label.toLowerCase();
  const plural = orgTypeDisplay[orgType].pluralLabel.toLowerCase();

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
            {selected.length > 0
              ? `${selected.length} ${selected.length > 1 ? plural : singular} selected`
              : `Filter by ${singular}`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder={`Search ${plural}...`} />
            <CommandEmpty>No {plural} found.</CommandEmpty>
            <CommandGroup className="max-h-96 overflow-y-auto">
              {orgs?.map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.name}
                  onSelect={() => {
                    onSelect(org);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      isOrgSelected(selected, org)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {org.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
