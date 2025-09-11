import type { Control, FieldValues, Path } from "react-hook-form";
import * as React from "react";

import { cn } from "@acme/ui";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export type ControlledInputProps<T extends FieldValues> = Omit<
  InputProps,
  "value"
> & {
  control: Control<T>;
  name: Path<T>;
  label?: string;
  placeholder?: string;
  itemClassName?: string;
  inputClassName?: string;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

const ControlledInput = <T extends FieldValues>(
  props: ControlledInputProps<T>,
) => {
  const {
    control,
    name,
    label,
    placeholder,
    itemClassName,
    className,
    ...rest
  } = props;
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={itemClassName}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              placeholder={placeholder}
              className={className}
              {...rest}
              {...field}
              value={field.value}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

export { ControlledInput, Input };
