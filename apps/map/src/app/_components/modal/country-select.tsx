import type { Control, FieldValues, Path } from "react-hook-form";
import { useMemo } from "react";
import { Controller } from "react-hook-form";

import { COUNTRIES } from "@acme/shared/app/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";

interface CountrySelectProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export const CountrySelect = <T extends FieldValues>({
  control,
  name,
  label,
  placeholder = "Select a country",
  required = false,
  disabled = false,
}: CountrySelectProps<T>) => {
  const sortedCountries = useMemo(() => {
    return [...COUNTRIES].sort((a, b) =>
      a.code === "US" ? -1 : b.code === "US" ? 1 : a.name.localeCompare(b.name),
    );
  }, []);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="space-y-2">
          {label && (
            <div className="text-sm font-medium text-muted-foreground">
              {label} {required && <span className="text-destructive">*</span>}
            </div>
          )}
          <Select
            value={field.value || ""}
            onValueChange={field.onChange}
            key={field.value}
            disabled={disabled}
          >
            <SelectTrigger id={name} aria-label={label}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {sortedCountries.map((country) => (
                <SelectItem key={country.code} value={country.name}>
                  {country.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.error && (
            <p className="text-xs text-destructive">
              {fieldState.error.message}
            </p>
          )}
        </div>
      )}
    />
  );
};
