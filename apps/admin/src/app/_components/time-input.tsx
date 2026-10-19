/**
 * Generated with v0.
 * @see https://v0.dev/t/1U7tA9qTarA
 */
import type { Control, FieldValues, Path } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@acme/ui/form";
import { Input } from "@acme/ui/input";

interface ControlledTimeInputProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label?: string;
}

export const ControlledTimeInput = <T extends FieldValues>({
  control,
  name,
  label,
}: ControlledTimeInputProps<T>) => {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Input
                type="time"
                {...field}
                value={field.value ?? ""}
                className="w-full"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
};
