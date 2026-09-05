"use client";

import type { Control, FieldValues, Path } from "react-hook-form";
import { useController } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const OCCURRENCE_LABELS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
};

export type ScheduleType = "weekly" | "biweekly" | "monthly" | "custom";

/**
 * Only "weekly" (interval 1 or null), "biweekly" (interval 2), and "monthly"
 * are selectable in the UI. "custom" covers data set another way (e.g.
 * interval 3+), so it can be displayed truthfully without the Select
 * silently collapsing it into "weekly" and losing the stored interval.
 */
export function deriveScheduleType(
  recurrencePattern: string | null | undefined,
  recurrenceInterval: number | null | undefined,
): ScheduleType {
  if (recurrencePattern === "monthly") return "monthly";
  if (recurrenceInterval != null && recurrenceInterval > 1) {
    return recurrenceInterval === 2 ? "biweekly" : "custom";
  }
  return "weekly";
}

interface ScheduleFieldsProps<T extends FieldValues> {
  control: Control<T>;
  recurrencePatternName: Path<T>;
  recurrenceIntervalName: Path<T>;
  indexWithinIntervalName: Path<T>;
  /** Extra classes merged onto each field's wrapping FormItem, e.g. to fit a caller's grid/flex layout. */
  wrapperClassName?: string;
}

/**
 * Shared "Schedule" (weekly/biweekly/monthly) + "Which occurrence?" controls
 * used by the admin and map location-event forms and the admin workouts
 * modal. Field names are parameterized since each form names them
 * differently (e.g. `eventRecurrencePattern` vs `recurrencePattern`).
 */
export function ScheduleFields<T extends FieldValues>({
  control,
  recurrencePatternName,
  recurrenceIntervalName,
  indexWithinIntervalName,
  wrapperClassName,
}: ScheduleFieldsProps<T>) {
  const { field: intervalField } = useController({
    control,
    name: recurrenceIntervalName,
  });
  const { field: indexField } = useController({
    control,
    name: indexWithinIntervalName,
  });

  const recurrenceInterval = intervalField.value as number | null | undefined;

  return (
    <>
      <FormField
        control={control}
        name={recurrencePatternName}
        render={({ field: patternField }) => {
          const recurrencePattern = patternField.value as
            string | null | undefined;
          const scheduleType = deriveScheduleType(
            recurrencePattern,
            recurrenceInterval,
          );

          return (
            <FormItem className={wrapperClassName}>
              <FormLabel>Schedule</FormLabel>
              <Select
                value={scheduleType}
                onValueChange={(v) => {
                  if (v === "biweekly") {
                    patternField.onChange("weekly");
                    intervalField.onChange(2);
                  } else if (v === "monthly") {
                    patternField.onChange("monthly");
                    intervalField.onChange(null);
                  } else {
                    patternField.onChange("weekly");
                    intervalField.onChange(null);
                  }
                  if (v !== "monthly") {
                    indexField.onChange(null);
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Every week" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="weekly">Every week</SelectItem>
                  <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  <SelectItem value="monthly">Once a month</SelectItem>
                  {scheduleType === "custom" && (
                    <SelectItem value="custom" disabled>
                      Every {recurrenceInterval} weeks
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          );
        }}
      />

      <ScheduleOccurrenceField
        control={control}
        indexWithinIntervalName={indexWithinIntervalName}
        recurrencePatternName={recurrencePatternName}
        wrapperClassName={wrapperClassName}
      />
    </>
  );
}

function ScheduleOccurrenceField<T extends FieldValues>({
  control,
  recurrencePatternName,
  indexWithinIntervalName,
  wrapperClassName,
}: {
  control: Control<T>;
  recurrencePatternName: Path<T>;
  indexWithinIntervalName: Path<T>;
  wrapperClassName?: string;
}) {
  const { field: patternField } = useController({
    control,
    name: recurrencePatternName,
  });

  if (patternField.value !== "monthly") return null;

  return (
    <FormField
      control={control}
      name={indexWithinIntervalName}
      render={({ field }) => (
        <FormItem className={wrapperClassName}>
          <FormLabel>Which occurrence?</FormLabel>
          <Select
            value={typeof field.value === "number" ? String(field.value) : ""}
            onValueChange={(v) => field.onChange(v ? Number(v) : null)}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select occurrence" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {[1, 2, 3, 4].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {OCCURRENCE_LABELS[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
