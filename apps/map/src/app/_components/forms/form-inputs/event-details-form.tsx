import { Controller, useFormContext } from "react-hook-form";
import type { EventFieldsType } from "@acme/validators/request-schemas";
import { DayOfWeek } from "@acme/shared/app/enums";
import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";
import { Input } from "@acme/ui/input";
import { MultiSelect } from "@acme/ui/multi-select";
import { ControlledSelect } from "@acme/ui/select";
import { Textarea } from "@acme/ui/textarea";

import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import { ControlledTimeInput } from "./controlled-time-input";
import { useEffect } from "react";

interface EventDetailsFormValues {
  originalRegionId?: number | null;
  eventName?: string;
  eventDayOfWeek?: DayOfWeek | null;
  eventTypeIds?: number[];
  eventStartTime?: string;
  eventEndTime?: string;
  eventDescription?: string;
  currentValues?: Partial<EventFieldsType>;
}

export const EventDetailsForm = <_T extends EventDetailsFormValues>() => {
  // I'd like for this to be generic, but the types don't seem to be working as expected.
  const form = useFormContext<EventDetailsFormValues>();
  const formRegionId = form.watch("originalRegionId");
  const currentValues = form.watch("currentValues");
  const formEventDayOfWeek = form.watch("eventDayOfWeek");
  const formEventStartTime = form.watch("eventStartTime");
  const formEventEndTime = form.watch("eventEndTime");
  const formEventTypeIds = form.watch("eventTypeIds");
  const formEventDescription = form.watch("eventDescription");
  const formEventName = form.watch("eventName");

  // Get event types for the region
  const orgIds = formRegionId ? [formRegionId] : [];
  const { data: eventTypes } = useFetchAllPages({
    queryKey: ["eventType.all.everyMatching", orgIds],
    enabled: formRegionId != null,
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { eventTypes: items, totalCount } = await client.eventType.all({
        orgIds,
        pageIndex,
        pageSize,
      });
      return { items, total: totalCount };
    },
  });

  useEffect(() => {
    if (!eventTypes) return;
    const validIds = new Set(eventTypes.map((type) => type.id));
    const selectedIds = form.getValues("eventTypeIds") ?? [];
    const nextIds = selectedIds.filter((id) => validIds.has(id));
    if (nextIds.length !== selectedIds.length) {
      form.setValue("eventTypeIds", nextIds, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [eventTypes, form]);

  return (
    <>
      <h2 className="mt-4 mb-2 text-xl font-semibold text-muted-foreground">
        Event Details:
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Workout Name
          </div>
          <Input {...form.register("eventName")} />
          {currentValues?.eventName &&
            currentValues.eventName !== formEventName && (
              <p className="text-xs text-muted-foreground line-through">
                {currentValues.eventName}
              </p>
            )}
          <p className="text-xs text-destructive">
            {form.formState.errors.eventName?.message}
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            Day of Week
          </div>
          <ControlledSelect
            control={form.control}
            name="eventDayOfWeek"
            options={DayOfWeek.map((day) => ({
              value: day,
              label: convertCase({
                str: day,
                fromCase: Case.LowerCase,
                toCase: Case.TitleCase,
              }),
            }))}
            placeholder="Select a day of the week"
          />
          {currentValues?.eventDayOfWeek &&
            currentValues.eventDayOfWeek !== formEventDayOfWeek && (
              <p className="text-xs text-muted-foreground line-through">
                {currentValues.eventDayOfWeek}
              </p>
            )}
          <p className="text-xs text-destructive">
            {form.formState.errors.eventDayOfWeek?.message}
          </p>
        </div>

        <div className="space-y-2">
          <ControlledTimeInput
            name="eventStartTime"
            id="eventStartTime"
            label="Start Time"
          />
          {currentValues?.eventStartTime &&
            currentValues.eventStartTime !== formEventStartTime && (
              <p className="text-xs text-muted-foreground line-through">
                {formatTime(currentValues.eventStartTime)}
              </p>
            )}
        </div>
        <div className="space-y-2">
          <ControlledTimeInput
            name="eventEndTime"
            id="eventEndTime"
            label="End Time"
          />
          {currentValues?.eventEndTime &&
            currentValues.eventEndTime !== formEventEndTime && (
              <p className="text-xs text-muted-foreground line-through">
                {formatTime(currentValues.eventEndTime)}
              </p>
            )}
          <p className="text-xs text-destructive">
            {form.formState.errors.eventEndTime?.message?.toString()}
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Event Types
          </div>
          <Controller
            control={form.control}
            name="eventTypeIds"
            render={({ field, fieldState }) => {
              return (
                <div>
                  <MultiSelect
                    hideSelectAll
                    defaultValue={(field.value ?? []).map(String)}
                    value={(field.value ?? []).map(String)}
                    options={
                      eventTypes?.map((type) => ({
                        label: type.name,
                        value: type.id.toString(),
                      })) ?? []
                    }
                    onValueChange={(values) =>
                      field.onChange(values.map(Number))
                    }
                    placeholder="Select event types"
                  />
                  {fieldState.error && (
                    <p className="text-xs text-destructive">
                      You must select at least one event type
                    </p>
                  )}
                </div>
              );
            }}
          />
          {currentValues?.eventTypeIds &&
            JSON.stringify(currentValues.eventTypeIds) !==
              JSON.stringify(formEventTypeIds) && (
              <p className="text-xs text-muted-foreground line-through">
                {currentValues.eventTypeIds
                  .map((id) => eventTypes?.find((type) => type.id === id)?.name)
                  .join(", ")}
              </p>
            )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="text-sm font-medium text-muted-foreground">
            Event Description
          </div>
          <Textarea
            {...form.register("eventDescription")}
            placeholder="Tell people if there's anything they need to know prior to showing up to the workout"
          />
          {currentValues?.eventDescription &&
            currentValues.eventDescription !== formEventDescription && (
              <p className="text-xs text-muted-foreground line-through">
                {currentValues.eventDescription}
              </p>
            )}
          <p className="text-xs text-destructive">
            {form.formState.errors.eventDescription?.message}
          </p>
        </div>
      </div>
    </>
  );
};

const formatTime = (time: string) => {
  if (!/^\d{4}$/.test(time)) return time;
  let hours = parseInt(time.slice(0, 2), 10);
  const minutes = time.slice(2, 4);
  const period = hours >= 12 ? "pm" : "am";
  hours = hours % 12 === 0 ? 12 : hours % 12;
  return `${hours}:${minutes}${period}`;
};
