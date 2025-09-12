"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDownIcon } from "lucide-react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandSeparator,
} from "@acme/ui/command";
import { Label } from "@acme/ui/label";
import {
  Popover,
  PopoverContentWithoutPortal,
  PopoverTrigger,
} from "@acme/ui/popover";

const MIN_WIDTH = 300;

interface Option<T> {
  value: string;
  label: string;
  labelComponent?: React.ReactNode;
  data?: T;
}

interface VirtualizedCommandProps<T> {
  options: Option<T>[];
  label?: string;
  placeholder: string;
  selectedOptions: string[];
  onSelectOption?: (option: string) => void;
  onClear?: () => void;
}

const VirtualizedCommand = <T,>({
  options,
  label,
  placeholder,
  selectedOptions,
  onSelectOption,
  onClear,
}: VirtualizedCommandProps<T>) => {
  const [filteredOptions, setFilteredOptions] = useState<Option<T>[]>(options);
  const parentRef = useRef(null);

  const sortedFilteredOptions = useMemo(() => {
    return filteredOptions.sort((a, b) => {
      if (selectedOptions.includes(a.value)) {
        return -1;
      }
      if (selectedOptions.includes(b.value)) {
        return 1;
      }
      return 0;
    });
  }, [filteredOptions, selectedOptions]);

  const virtualizer = useVirtualizer({
    count: sortedFilteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 5,
  });

  const virtualOptions = virtualizer.getVirtualItems();

  const handleSearch = (search: string) => {
    setFilteredOptions(
      options.filter((option) =>
        option.label.toLowerCase().includes(search.toLowerCase() ?? []),
      ),
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
    }
  };

  return (
    <Command shouldFilter={false} onKeyDown={handleKeyDown}>
      {label ? <Label>{label}</Label> : null}
      <CommandInput onValueChange={handleSearch} placeholder={placeholder} />
      <CommandEmpty>No item found.</CommandEmpty>
      <CommandGroup
        ref={parentRef}
        style={{
          height: 300,
          width: "100%",
          overflow: "auto",
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualOptions.map((virtualOption) => (
            <CommandItem
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualOption.size}px`,
                transform: `translateY(${virtualOption.start}px)`,
              }}
              key={sortedFilteredOptions[virtualOption.index]?.value}
              value={sortedFilteredOptions[virtualOption.index]?.value}
              onSelect={(selectedItem) => {
                const item = sortedFilteredOptions[virtualOption.index]?.value;
                onSelectOption?.(item ?? selectedItem);
              }}
              className="flex items-center justify-between"
            >
              <Check
                className={cn("mr-2 h-4 w-4 opacity-0", {
                  "opacity-100": selectedOptions.includes(
                    sortedFilteredOptions[virtualOption.index]?.value ?? "",
                  ),
                })}
              />
              <div className="line-clamp-1 flex flex-1 items-center justify-between leading-4">
                <div>
                  {sortedFilteredOptions[virtualOption.index]?.labelComponent ??
                    sortedFilteredOptions[virtualOption.index]?.label}
                </div>
              </div>
            </CommandItem>
          ))}
        </div>
      </CommandGroup>
      <CommandSeparator />
      <div className="flex justify-end px-4 py-2">
        <Button type="button" onClick={onClear} variant="ghost">
          Clear
        </Button>
      </div>
    </Command>
  );
};

interface VirtualizedComboboxProps<T> {
  disabled?: boolean;
  value?: string | string[];
  options: Option<T>[];
  label?: string;
  searchPlaceholder?: string;
  onSelect?: (items: string | string[]) => void;
  required?: boolean;
  isMulti?: boolean;
  className?: string;
  popoverContentAlign?: "start" | "center" | "end";
}

export function VirtualizedCombobox<T>({
  value,
  options,
  label,
  searchPlaceholder,
  onSelect,
  required,
  isMulti,
  disabled,
  className,
  popoverContentAlign,
}: VirtualizedComboboxProps<T>) {
  const [open, setOpen] = useState<boolean>(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>(
    typeof value === "string" ? [value] : value ?? [],
  );
  const valueToLabel = useMemo(() => {
    return options.reduce(
      (acc, option) => {
        acc[option.value] = option.label;
        return acc;
      },
      {} as Record<string, string>,
    );
  }, [options]);

  const [buttonWidth, setButtonWidth] = useState(0);

  useEffect(() => {
    setSelectedOptions(typeof value === "string" ? [value] : value ?? []);
  }, [value]);

  const handleSelect = (currentValue: string) => {
    let newOptions: string[] = [];
    if (isMulti) {
      newOptions = selectedOptions.includes(currentValue)
        ? selectedOptions.filter((option) => option !== currentValue)
        : [...selectedOptions, currentValue];
      onSelect?.(newOptions);
    } else {
      newOptions = [currentValue];
      onSelect?.(currentValue);
    }

    setSelectedOptions(newOptions);
    if (!isMulti) {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild className="group relative w-full">
        <Button
          variant="outline"
          disabled={disabled}
          role="combobox"
          // aria-expanded={open}
          className={cn(
            "relative flex w-full rounded-md border px-3 pb-1 pr-8 text-left ring-offset-white placeholder:text-slate-500",
            "dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:placeholder:text-slate-400 dark:focus-visible:ring-slate-300",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:cursor-not-allowed disabled:opacity-50",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            className,
          )}
          ref={(element) => setButtonWidth(element?.offsetWidth ?? 0)}
        >
          <label
            className={cn(
              "absolute left-0 top-0 px-3 font-semibold tracking-wide text-primary",
            )}
          >
            {label}
            {required ? <span className="text-red-500">*</span> : null}
          </label>
          <div className={cn("w-full text-left text-sm font-normal leading-3")}>
            {!selectedOptions?.length ? (
              searchPlaceholder
            ) : selectedOptions.length === 1 ? (
              valueToLabel[selectedOptions[0]!]
            ) : selectedOptions.length > 1 ? (
              <div>
                {valueToLabel[selectedOptions[0]!]}{" "}
                <span className="">+{selectedOptions.length - 1} </span>
              </div>
            ) : null}
          </div>
          <div className="absolute right-3 top-0 flex h-full items-center">
            <ChevronDownIcon className="h-4 w-4 transition duration-200 group-data-[state=open]:rotate-180" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContentWithoutPortal
        // To prevent the change to the top of the search
        // https://www.radix-ui.com/primitives/docs/components/popover#content
        avoidCollisions={false}
        side="bottom"
        className={cn("p-0")}
        style={{
          width: buttonWidth,
          minWidth: MIN_WIDTH,
          // Must have this z-index to avoid issue with it appearing
          // behind the file input
          zIndex: Z_INDEX.POPOVER_CONTENT,
        }}
        align={
          popoverContentAlign ?? (buttonWidth < MIN_WIDTH ? "start" : "center")
        }
      >
        <VirtualizedCommand
          options={options}
          placeholder={searchPlaceholder ?? "Search"}
          selectedOptions={selectedOptions}
          onSelectOption={handleSelect}
          onClear={() => {
            console.log("onClear");
            setSelectedOptions([]);
            setOpen(false);
            onSelect?.([]);
          }}
        />
      </PopoverContentWithoutPortal>
    </Popover>
  );
}
