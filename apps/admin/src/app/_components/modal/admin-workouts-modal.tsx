"use client";
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { EVENT_CATEGORY_LABEL_MAP, Z_INDEX } from "@acme/shared/app/constants";
import { DayOfWeek } from "@acme/shared/app/enums";
import {
  convertHH_mmToHHmm,
  convertHHmmToHH_mm,
} from "@acme/shared/app/functions";
import { Case } from "@acme/shared/common/enums";
import { convertCase, safeParseInt } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
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
  ControlledSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { EventInsertSchema } from "@acme/validators";

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

const EventInsertForm = EventInsertSchema.extend({
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    error: "Start time must be in 24hr format (HH:mm)",
  }),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    error: "End time must be in 24hr format (HH:mm)",
  }),
  eventTypeIds: z.number().array().min(1, { error: "Event type is required" }),
  startDate: z.string().min(1, { error: "Start date is required" }),
  dayOfWeek: z.enum(DayOfWeek, {
    error: "Day of week is required",
  }),
});
type EventInsertFormType = z.infer<typeof EventInsertForm>;

export default function AdminWorkoutsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_EVENTS];
}) {
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const { data: locations } = useQuery(
    orpc.location.all.queryOptions({ input: { statuses: ["active"] } }),
  );
  const { data: aos } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["ao"] } }),
  );
  const { data: eventResponse, isLoading: isLoadingEvent } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: data.id ?? -1 },
      enabled: gte(data.id, 0),
    }),
  );
  const event = eventResponse?.event;
  const isEditing = !!event;
  const actionText = isEditing ? "update" : "create";
  const fallbackActionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";

  const isLoading = gte(data.id, 0) && isLoadingEvent;
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm({
    schema: EventInsertForm,
  });

  // Watch regionId from form to filter event types
  const formRegionId = form.watch("regionId");

  const { data: eventTypes } = useQuery(
    orpc.eventType.all.queryOptions({
      input: {
        pageSize: 200,
        // When region is selected: filter to that region's types + Nation types
        // When no region selected: show all event types (pass undefined to get all)
        orgIds: formRegionId ? [formRegionId] : undefined,
      },
    }),
  );

  useEffect(() => {
    form.reset({
      id: event?.id,
      name: event?.name ?? "",
      locationId: event?.locationId ?? null,
      email: event?.email, // must keep undefined as "" is broken email
      startTime: convertHHmmToHH_mm(event?.startTime ?? ""),
      endTime: convertHHmmToHH_mm(event?.endTime ?? ""),
      startDate: event?.startDate ?? "",
      endDate: event?.endDate ?? "",
      dayOfWeek: event?.dayOfWeek ?? undefined,
      isActive: event?.isActive ?? true,
      highlight: event?.highlight ?? false,
      regionId: event?.regions?.[0]?.regionId ?? undefined,
      aoId: event?.aos?.[0]?.aoId ?? undefined,
      eventTypeIds: event?.eventTypes?.map((et) => et.eventTypeId),
      meta: {
        mapSeed: !!event?.meta?.mapSeed,
      },
      description: event?.description ?? "",
      isPrivate: event?.isPrivate ?? false,
    });
  }, [form, event]);

  const crupdateEvent = useMutation(
    orpc.event.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("map");
        await invalidateQueries("event");
        closeModal();
        toast.success(`Successfully ${actionTextPast} event`);
        router.refresh();
        setIsSubmitting(false);
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? `You are not authorized to ${actionText} this event`
            : `Failed to ${fallbackActionText} event`,
        );
        setIsSubmitting(false);
      },
    }),
  );

  const onSubmit = async (data: EventInsertFormType) => {
    // Validate times
    const eventTypeIds = data.eventTypeIds;
    if (!eventTypeIds.length) {
      form.setError("eventTypeIds", {
        message: "At least one event type is required",
      });
      toast.error("At least one event type is required");
      return;
    }

    const startTime = data.startTime;
    const endTime = data.endTime;

    if (startTime && endTime) {
      if (startTime > endTime) {
        form.setError("endTime", {
          message: "End time must be after start time",
        });
        toast.error("End time must be after start time");
        return;
      }
    }

    if (data.endDate && data.startDate && data.endDate < data.startDate) {
      form.setError("endDate", {
        message: "End date must be on or after start date",
      });
      toast.error("End date must be on or after start date");
      return;
    }

    // Validate day of week
    // if (!data.dayOfWeek) {
    //   form.setError("dayOfWeek", { message: "Day of week is required" });
    //   toast.error("Day of week is required");
    //   return;
    // }

    // // Validate event type
    // if (!data.eventTypeId) {
    //   form.setError("eventTypeId", { message: "Event type is required" });
    //   toast.error("Event type is required");
    //   return;
    // }

    setIsSubmitting(true);
    await crupdateEvent.mutateAsync({
      ...data,
      startTime: convertHH_mmToHHmm(startTime),
      endTime: convertHH_mmToHHmm(endTime),
    });
  };

  const showDeleteButton = isEditing && event?.isActive !== false;

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {event?.id ? "Edit" : "Add"} Event
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-2">
              <Spinner className="size-8" />
              <p className="text-sm text-muted-foreground">Loading event...</p>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex flex-wrap">
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ID</FormLabel>
                        <FormControl>
                          <Input placeholder="ID" disabled {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Name"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="regionId"
                    render={({ field }) => (
                      <FormItem key={`region-${String(field.value ?? "new")}`}>
                        <FormLabel>Region</FormLabel>
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
                              toast.error("Invalid orgId");
                              return;
                            }
                            field.onChange(orgId);
                          }}
                          isMulti={false}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="aoId"
                    render={({ field }) => {
                      const filteredAOs = aos?.orgs.filter(
                        (ao) => ao.parentId === form.watch("regionId"),
                      );
                      return (
                        <FormItem key={`ao-${String(field.value ?? "new")}`}>
                          <FormLabel>AO</FormLabel>
                          <Select
                            value={field.value?.toString()}
                            onValueChange={(value) => {
                              const aoId = safeParseInt(value);
                              field.onChange(aoId);

                              const selectedAO = aos?.orgs.find(
                                (ao) => ao.id === aoId,
                              );
                              if (!selectedAO) {
                                toast.error("Invalid AO");
                                return;
                              }
                              if (selectedAO.parentId != null) {
                                form.setValue("regionId", selectedAO.parentId);
                              }

                              const regionId = form.getValues("regionId");
                              const regionLocations =
                                locations?.locations.filter(
                                  (l) => l.regionId === regionId,
                                );

                              // If the current location's parentId is not the selected AO, then we need to update the location
                              const locationId = form.getValues("locationId");
                              if (
                                !regionLocations?.find(
                                  (l) => l.id === locationId,
                                )
                              ) {
                                form.setValue(
                                  "locationId",
                                  regionLocations?.[0]?.id ?? null,
                                );
                              }
                            }}
                            defaultValue={field.value?.toString()}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select an AO" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredAOs
                                ?.slice()
                                .sort(
                                  (a, b) =>
                                    a.name?.localeCompare(b.name ?? "") ?? 0,
                                )
                                .map((ao) => (
                                  <SelectItem
                                    key={`ao-${ao.id}`}
                                    value={ao.id.toString()}
                                  >
                                    {ao.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="locationId"
                    render={({ field }) => {
                      const regionId = form.getValues("regionId");
                      const filteredLocations = locations?.locations.filter(
                        (location) => location.regionId === regionId,
                      );
                      return (
                        <FormItem
                          key={`location-${String(field.value ?? "new")}`}
                        >
                          <FormLabel>Location</FormLabel>
                          <Select
                            value={field.value?.toString()}
                            onValueChange={(value) => {
                              console.log("locationId onValueChange", value);
                              field.onChange(Number(value));

                              const selectedLocation =
                                locations?.locations.find(
                                  (location) => location.id === Number(value),
                                );
                              if (selectedLocation?.regionId != null) {
                                form.setValue(
                                  "regionId",
                                  selectedLocation.regionId,
                                );
                              }
                            }}
                            defaultValue={field.value?.toString()}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a location" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredLocations
                                ?.slice()
                                .sort(
                                  (a, b) =>
                                    a.locationName?.localeCompare(
                                      b.locationName ?? "",
                                    ) ?? 0,
                                )
                                .map((location) => (
                                  <SelectItem
                                    key={`location-${location.id}`}
                                    value={location.id.toString()}
                                  >
                                    {location.locationName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Email"
                            type="email"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="mb-4 w-1/2 px-2">
                  <ControlledSelect
                    control={form.control}
                    name="dayOfWeek"
                    label="Day of Week"
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
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="eventTypeIds"
                    render={({ field }) => (
                      <FormItem key={`eventTypeIds`}>
                        <FormLabel>Event Types</FormLabel>
                        <VirtualizedCombobox
                          value={(field.value as number[] | undefined)?.map(
                            String,
                          )}
                          options={
                            eventTypes?.eventTypes.map((type) => ({
                              value: type.id.toString(),
                              label: type.eventCategory
                                ? `${type.name} (${EVENT_CATEGORY_LABEL_MAP[type.eventCategory] ?? type.eventCategory})`
                                : type.name,
                            })) ?? []
                          }
                          searchPlaceholder={
                            formRegionId
                              ? "Select event types"
                              : "Select a region first"
                          }
                          disabled={!formRegionId}
                          onSelect={(value) => {
                            if (!Array.isArray(value)) {
                              toast.error("Invalid event type");
                              return;
                            }
                            const eventTypeIds = value.map(safeParseInt);
                            field.onChange(eventTypeIds);
                          }}
                          isMulti={true}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <ControlledTimeInput
                    control={form.control}
                    name="startTime"
                    id={"startTime"}
                    label={"Start Time"}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <ControlledTimeInput
                    control={form.control}
                    name="endTime"
                    id={"endTime"}
                    label={"End Time"}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Date</FormLabel>
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
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Date</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="End Date"
                            type="date"
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value || null)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="isPrivate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Visibility</FormLabel>
                        <Select
                          onValueChange={(value) =>
                            value &&
                            field.onChange(value === "true" ? true : false)
                          }
                          value={field.value === true ? "true" : "false"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select visibility" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="false">Public</SelectItem>
                            <SelectItem value="true">Private</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-1/2 px-2">
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select
                          onValueChange={(value) =>
                            value &&
                            field.onChange(value === "true" ? true : false)
                          }
                          value={field.value === true ? "true" : "false"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="true">Active</SelectItem>
                            <SelectItem value="false">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-full px-2">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <Textarea
                          {...field}
                          value={field.value ?? ""}
                          rows={5}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="mb-4 w-full px-2">
                  <div className="flex space-x-4 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => closeModal()}
                      className="w-full"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="w-full">
                      {isSubmitting ? (
                        <div className="flex items-center gap-2">
                          Saving... <Spinner className="size-4" />
                        </div>
                      ) : (
                        "Save Changes"
                      )}
                    </Button>
                  </div>
                </div>
                {showDeleteButton ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      closeModal();
                      openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                        id: event?.id ?? -1,
                        type: DeleteType.EVENT,
                      });
                    }}
                    className="w-full"
                  >
                    Deactivate Event
                  </Button>
                ) : null}
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
