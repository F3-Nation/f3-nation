"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
import { SeriesException } from "@acme/shared/app/enums";
import {
  convertHH_mmToHHmm,
  convertHHmmToHH_mm,
} from "@acme/shared/app/functions";
import { safeParseInt } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Checkbox } from "@acme/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@acme/ui/form";
import { Input } from "@acme/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import gte from "lodash/gte";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import type { DataType } from "~/utils/store/modal";
import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
} from "~/utils/store/modal";
import { ControlledTimeInput } from "../time-input";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

const NONE = "__none__";

function seriesExceptionLabel(value: string): string {
  switch (value) {
    case "closed":
      return "Closed";
    case "different-time":
      return "Different time";
    case "miscellaneous":
      return "Miscellaneous";
    default:
      return value;
  }
}

const EventInstanceFormSchema = z
  .object({
    regionId: z.number().optional(),
    orgId: z
      .number()
      .refine((n) => n > 0, { message: "Select an organization" }),
    locationId: z.number().nullable().optional(),
    startDate: z.string().min(1, { message: "Start date is required" }),
    endDate: z.string().nullable().optional(),
    name: z.string().optional(),
    description: z.string().nullish(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    eventTypeId: z.number().optional(),
    seriesId: z.number().nullable().optional(),
    seriesException: z
      .enum(["closed", "different-time", "miscellaneous"])
      .nullable()
      .optional(),
    isPrivate: z.boolean(),
    highlight: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (
      data.startTime &&
      data.endTime &&
      data.startTime.length === 5 &&
      data.endTime.length === 5
    ) {
      if (data.startTime > data.endTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End time must be after start time",
          path: ["endTime"],
        });
      }
    }
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after start date",
        path: ["endDate"],
      });
    }
  });

type EventInstanceFormValues = z.infer<typeof EventInstanceFormSchema>;

export default function AdminEventInstancesModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_EVENT_INSTANCES];
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const { data: aos } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );
  const { data: locations } = useQuery(
    orpc.location.all.queryOptions({ input: { statuses: ["active"] } }),
  );

  const { data: instanceResponse, isLoading: isLoadingInstance } = useQuery(
    orpc.eventInstance.byId.queryOptions({
      input: { id: data.id ?? -1 },
      enabled: gte(data.id, 0),
    }),
  );

  const instance = instanceResponse ?? undefined;
  const isEditing = !!instance;
  const isLoading = gte(data.id, 0) && isLoadingInstance;

  const form = useForm({
    schema: EventInstanceFormSchema,
  });

  const formRegionId = form.watch("regionId");

  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({
      input: {
        pageSize: 200,
        orgIds: formRegionId ? [formRegionId] : undefined,
        sorting: [{ id: "name", desc: false }],
      },
    }),
  );

  const { data: eventsResponse } = useQuery(
    orpc.event.all.queryOptions({
      input: {
        pageSize: 500,
        regionIds: formRegionId ? [formRegionId] : undefined,
        sorting: [{ id: "name", desc: false }],
      },
    }),
  );

  const sortedEventTypes = eventTypes?.eventTypes ?? [];
  const events = eventsResponse?.events ?? [];

  useEffect(() => {
    form.reset({
      regionId: instance?.org?.parentId ?? undefined,
      orgId: instance?.orgId ?? 0,
      locationId: instance?.locationId ?? null,
      startDate: instance?.startDate ?? "",
      endDate: instance?.endDate ?? null,
      name: instance?.name ?? "",
      description: instance?.description ?? "",
      startTime:
        instance?.startTime?.length === 4
          ? convertHHmmToHH_mm(instance.startTime)
          : null,
      endTime:
        instance?.endTime?.length === 4
          ? convertHHmmToHH_mm(instance.endTime)
          : null,
      eventTypeId: instance?.eventTypes?.[0]?.eventTypeId,
      seriesId: instance?.seriesId ?? null,
      seriesException: instance?.seriesException ?? null,
      isPrivate: instance?.isPrivate ?? false,
      highlight: instance?.highlight ?? false,
    });
  }, [form, instance]);

  const crupdateEventInstance = useMutation(
    orpc.eventInstance.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("eventInstance");
        closeModal();
        toast.success(
          isEditing
            ? "Successfully updated event instance"
            : "Successfully created event instance",
        );
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? (err.message ??
                "You are not authorized to create or update event instances")
            : "Failed to save event instance",
        );
      },
    }),
  );

  const onSubmit = async (formData: EventInstanceFormValues) => {
    setIsSubmitting(true);
    try {
      const startTime =
        formData.startTime?.length === 5
          ? convertHH_mmToHHmm(formData.startTime)
          : undefined;
      const endTime =
        formData.endTime?.length === 5
          ? convertHH_mmToHHmm(formData.endTime)
          : undefined;

      const trimmedName = formData.name?.trim();
      const descTrim = formData.description?.trim();
      await crupdateEventInstance.mutateAsync({
        ...(isEditing && data.id != null ? { id: data.id } : {}),
        orgId: formData.orgId,
        startDate: formData.startDate,
        endDate: formData.endDate,
        locationId: formData.locationId ?? null,
        name: trimmedName ?? undefined,
        description: descTrim == null || descTrim === "" ? null : descTrim,
        startTime: startTime ?? undefined,
        endTime: endTime ?? undefined,
        ...(formData.eventTypeId ? { eventTypeId: formData.eventTypeId } : {}),
        seriesId: formData.seriesId ?? null,
        seriesException: formData.seriesException ?? null,
        isPrivate: formData.isPrivate,
        highlight: formData.seriesId ? false : formData.highlight,
      });
    } catch {
      // handled in onError
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(
          "max-h-[90vh] max-w-[95%] overflow-y-auto rounded-lg sm:max-w-[90%] lg:max-w-[600px]",
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {isEditing ? "Edit" : "Add"} Event Instance
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="size-8" />
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4 px-2"
            >
              <FormField
                control={form.control}
                name="regionId"
                render={({ field }) => (
                  <FormItem key={`region-${String(field.value ?? "new")}`}>
                    <FormLabel>Region</FormLabel>
                    <FormControl>
                      <VirtualizedCombobox
                        value={field.value?.toString()}
                        options={
                          regions?.orgs?.map((region) => ({
                            value: region.id.toString(),
                            label: region.name,
                          })) ?? []
                        }
                        searchPlaceholder="Select a region"
                        onSelect={(value) => {
                          const orgId = safeParseInt(value as string);
                          if (orgId == null) {
                            toast.error("Invalid region");
                            return;
                          }
                          field.onChange(orgId);
                          form.setValue("orgId", 0);
                          form.setValue("locationId", null);
                          form.setValue("eventTypeId", undefined);
                          form.setValue("seriesId", null);
                        }}
                        isMulti={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="orgId"
                render={({ field }) => {
                  const filteredAOs = aos?.orgs
                    .filter((ao) => ao.parentId === form.watch("regionId"))
                    ?.slice()
                    .sort((a, b) => a.name?.localeCompare(b.name ?? "") ?? 0);
                  return (
                    <FormItem key={`ao-${String(field.value ?? "new")}`}>
                      <FormLabel>AO</FormLabel>
                      <FormControl>
                        <VirtualizedCombobox
                          value={
                            field.value > 0 ? field.value.toString() : undefined
                          }
                          options={
                            filteredAOs?.map((ao) => ({
                              value: ao.id.toString(),
                              label: ao.name ?? "",
                            })) ?? []
                          }
                          searchPlaceholder="Select an AO"
                          onSelect={(value) => {
                            const aoId = safeParseInt(value as string);
                            field.onChange(aoId ?? 0);

                            const selectedAO = aos?.orgs.find(
                              (ao) => ao.id === aoId,
                            );
                            if (selectedAO?.parentId != null) {
                              form.setValue("regionId", selectedAO.parentId);
                            }

                            const regionId = form.getValues("regionId");
                            const regionLocations = locations?.locations.filter(
                              (l) => l.regionId === regionId,
                            );
                            const locationId = form.getValues("locationId");
                            if (
                              locationId != null &&
                              !regionLocations?.find((l) => l.id === locationId)
                            ) {
                              form.setValue(
                                "locationId",
                                regionLocations?.[0]?.id ?? null,
                              );
                            }
                          }}
                          isMulti={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Start Date"
                        type="date"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="End Date"
                        type="date"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <ControlledTimeInput
                  control={form.control}
                  name="startTime"
                  id="startTime"
                  label="Start time (optional)"
                />
                <ControlledTimeInput
                  control={form.control}
                  name="endTime"
                  id="endTime"
                  label="End time (optional)"
                />
              </div>
              <FormField
                control={form.control}
                name="locationId"
                render={({ field }) => {
                  const filteredLocations = locations?.locations
                    .filter((location) => location.regionId === formRegionId)
                    ?.slice()
                    .sort(
                      (a, b) =>
                        a.locationName?.localeCompare(b.locationName ?? "") ??
                        0,
                    );
                  return (
                    <FormItem key={`location-${String(field.value ?? "none")}`}>
                      <FormLabel>Location (optional)</FormLabel>
                      <FormControl>
                        <VirtualizedCombobox
                          value={
                            field.value != null
                              ? field.value.toString()
                              : undefined
                          }
                          options={
                            filteredLocations?.map((location) => ({
                              value: location.id.toString(),
                              label: location.locationName ?? "",
                            })) ?? []
                          }
                          searchPlaceholder="Select a location"
                          onSelect={(value) => {
                            if (
                              value === "" ||
                              (Array.isArray(value) && value.length === 0)
                            ) {
                              field.onChange(null);
                              return;
                            }
                            const id = safeParseInt(value as string);
                            field.onChange(id ?? null);
                            const selectedLocation = locations?.locations.find(
                              (location) => location.id === id,
                            );
                            if (selectedLocation?.regionId != null) {
                              form.setValue(
                                "regionId",
                                selectedLocation.regionId,
                              );
                            }
                          }}
                          isMulti={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <FormField
                control={form.control}
                name="eventTypeId"
                render={({ field }) => (
                  <FormItem key={`eventType-${String(field.value ?? "none")}`}>
                    <FormLabel>Event type (optional)</FormLabel>
                    <Select
                      value={
                        field.value != null ? field.value.toString() : NONE
                      }
                      onValueChange={(value) => {
                        field.onChange(
                          value === NONE ? undefined : Number(value),
                        );
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Optional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {sortedEventTypes.map((et) => (
                          <SelectItem key={et.id} value={et.id.toString()}>
                            {et.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="seriesId"
                render={({ field }) => (
                  <FormItem key={`series-${String(field.value ?? "none")}`}>
                    <FormLabel>Series (optional)</FormLabel>
                    <FormControl>
                      <VirtualizedCombobox
                        value={
                          field.value != null
                            ? field.value.toString()
                            : undefined
                        }
                        options={events.map((event) => ({
                          value: event.id.toString(),
                          label: event.name ?? "",
                        }))}
                        searchPlaceholder="Select a series"
                        onSelect={(value) => {
                          if (
                            value === "" ||
                            (Array.isArray(value) && value.length === 0)
                          ) {
                            field.onChange(null);
                            return;
                          }
                          field.onChange(safeParseInt(value as string) ?? null);
                        }}
                        isMulti={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="seriesException"
                render={({ field }) => (
                  <FormItem
                    key={`seriesException-${String(field.value ?? "none")}`}
                  >
                    <FormLabel>Series exception (optional)</FormLabel>
                    <Select
                      value={field.value != null ? String(field.value) : NONE}
                      onValueChange={(value) => {
                        field.onChange(
                          value === NONE
                            ? null
                            : (value as (typeof SeriesException)[number]),
                        );
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {SeriesException.map((ex) => (
                          <SelectItem key={ex} value={ex}>
                            {seriesExceptionLabel(ex)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isPrivate"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <FormLabel className="!mt-0 font-normal">Private</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="highlight"
                render={({ field }) => {
                  const seriesId = form.watch("seriesId");
                  const isStandalone = seriesId == null;
                  return (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={isStandalone && field.value}
                          disabled={!isStandalone}
                          onCheckedChange={(v) => field.onChange(v === true)}
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 font-normal">
                        Highlight
                      </FormLabel>
                    </FormItem>
                  );
                }}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Defaults from AO and event type if empty"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => closeModal()}
                  className="w-full"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center gap-2">
                      Saving… <Spinner className="size-4" />
                    </span>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              {isEditing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    closeModal();
                    openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                      id: data.id ?? -1,
                      type: DeleteType.EVENT_INSTANCE,
                    });
                  }}
                  className="w-full"
                >
                  Delete instance
                </Button>
              ) : null}
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
