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

type Org = RouterOutputs["org"]["accessible"]["orgs"][number];

export const OrgFilter = ({
  onOrgSelect,
  selectedOrgs,
}: {
  onOrgSelect: (org: Org) => void;
  selectedOrgs: Org[];
}) => {
  const { data: accessibleOrgs } = useQuery(
    orpc.org.accessible.queryOptions({
      input: { orgTypes: ["area", "sector", "region", "nation"] },
    }),
  );

  const orgs = accessibleOrgs?.orgs;
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
            {selectedOrgs.length > 0
              ? `${selectedOrgs.length} org${selectedOrgs.length > 1 ? "s" : ""} selected`
              : "Filter by org"}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder="Search statuses..." />
            <CommandEmpty>No statuses found.</CommandEmpty>
            <CommandGroup className="max-h-96 overflow-y-auto">
              {orgs?.map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.name}
                  onSelect={() => {
                    onOrgSelect(org);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedOrgs.some((selected) => selected.id === org.id)
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
