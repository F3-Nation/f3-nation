/**
 * v0 by Vercel.
 * @see https://v0.dev/t/1U7tA9qTarA
 * Documentation: https://v0.dev/docs#integrating-generated-code-into-your-nextjs-app
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

interface TimeInputProps {
  label?: string;
  id?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

type ControlledTimeInputProps<T extends FieldValues> = Omit<
  TimeInputProps,
  "value" | "defaultValue" | "onChange"
> & {
  control: Control<T>;
  name: Path<T>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
};

export const TimeInput = ({ label, id, value, onChange }: TimeInputProps) => {
  return (
    <Input
      type="time"
      value={value}
      onChange={onChange}
      id={id}
      aria-label={label}
      className="w-full"
    />
  );
};

export const ControlledTimeInput = <T extends FieldValues>(
  props: ControlledTimeInputProps<T>,
) => {
  const { control, name, label, ...rest } = props;
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <TimeInput
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                }}
                {...rest}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
};
