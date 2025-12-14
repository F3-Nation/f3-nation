import type { FieldPath, FieldValues } from "react-hook-form";
import { Controller, useFormContext } from "react-hook-form";

import { FormControl, FormItem, FormLabel, FormMessage } from "@acme/ui/form";
import { Input } from "@acme/ui/input";

interface TimeInputProps<T extends FieldValues> {
  name: FieldPath<T>;
  id?: string;
  label: string;
}

export const ControlledTimeInput = <T extends FieldValues>({
  name,
  id,
  label,
}: TimeInputProps<T>) => {
  const form = useFormContext();

  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="time"
              id={id}
              value={
                typeof field.value === "string"
                  ? // Accepts both "0530" (stored) and "05:30" (displayed)
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                    field.value.length === 4 && !field.value.includes(":")
                    ? // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                      `${field.value.slice(0, 2)}:${field.value.slice(2)}`
                    : field.value
                  : ""
              }
              onChange={(e) => {
                const timeValue = e.target.value;
                // Convert "05:30" -> "0530" before storing in form
                if (timeValue && timeValue.includes(":")) {
                  const [h, m] = timeValue.split(":");
                  field.onChange(
                    (h?.padStart(2, "0") ?? "") + (m?.padStart(2, "0") ?? ""),
                  );
                } else {
                  field.onChange(timeValue);
                }
              }}
              className="w-full"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};
