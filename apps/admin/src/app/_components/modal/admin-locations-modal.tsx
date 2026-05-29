"use client";

import { CircleQuestionMark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { COUNTRIES, DEFAULT_CENTER, Z_INDEX } from "@acme/shared/app/constants";
import { safeParseFloat, safeParseInt } from "@acme/shared/common/functions";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@acme/ui/tooltip";
import { LocationInsertSchema } from "@acme/validators";

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
import { GoogleMapSimple } from "../map/google-map-simple";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

export default function AdminLocationsModal({
  data,
  googleApiKey,
  isProd,
}: {
  data: DataType[ModalType.ADMIN_LOCATIONS];
  googleApiKey: string;
  isProd: boolean;
}) {
  const { data: locationResponse } = useQuery(
    orpc.location.byId.queryOptions({
      input: { id: data.id ?? -1 },
      enabled: gte(data.id, 0),
    }),
  );
  const location = locationResponse?.location;
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    schema: LocationInsertSchema.omit({ orgId: true }).extend({
      regionId: z.number(),
      longitude: z.string(),
      latitude: z.string(),
    }),
  });
  const formLatitude = form.watch("latitude");
  const formLongitude = form.watch("longitude");

  useEffect(() => {
    form.reset({
      id: location?.id ?? undefined,
      name: location?.locationName ?? "",
      email: location?.email ?? "",
      description: location?.description ?? "",
      isActive: location?.isActive ?? true,
      regionId: location?.regionId ?? undefined,
      latitude: location?.latitude
        ? location.latitude.toString()
        : DEFAULT_CENTER[0].toString(),
      longitude: location?.longitude
        ? location.longitude.toString()
        : DEFAULT_CENTER[1].toString(),
      addressStreet: location?.addressStreet ?? null,
      addressStreet2: location?.addressStreet2 ?? null,
      addressCity: location?.addressCity ?? null,
      addressState: location?.addressState ?? null,
      addressZip: location?.addressZip ?? null,
      addressCountry: location?.addressCountry ?? null,
      // meta: location?.meta ?? null,
    });
  }, [form, location]);

  const isEditing = !!location?.id;
  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";

  const crupdateLocation = useMutation(
    orpc.location.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("location");
        closeModal();
        toast.success(`Successfully ${actionTextPast} location`);
        router.refresh();
        setIsSubmitting(false);
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? `You are not authorized to ${actionText} this location`
            : `Failed to ${actionText} location`,
        );
        setIsSubmitting(false);
      },
    }),
  );

  const sortedCountries = useMemo(() => {
    return [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(
          `max-w-[95%] rounded-lg sm:max-w-[90%] lg:max-w-[1024px] max-h-[90vh] overflow-y-auto`,
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {location?.id ? "Edit" : "Add"} Location
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row md:flex-wrap">
          Locations are the the placements of workouts. They are grouped by
          regions.
          <div className="w-full md:w-1/2">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(async (data) => {
                  setIsSubmitting(true);
                  if (!data?.regionId) {
                    toast.error("Region not found");
                    return;
                  }
                  await crupdateLocation.mutateAsync({
                    ...data,
                    orgId: data.regionId,
                    latitude: safeParseFloat(data.latitude),
                    longitude: safeParseFloat(data.longitude),
                  });
                })}
                className="space-y-4"
              >
                <div className="flex flex-wrap">
                  <div className="mb-4 w-full px-2 sm:w-1/2">
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
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger type="button">
                                <CircleQuestionMark
                                  size={14}
                                  className="display-inline ml-2"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                The name of the location (not the AO)
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="regionId"
                      render={({ field }) => (
                        <FormItem
                          key={`region-${String(field.value ?? "new")}`}
                        >
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

                  <div className="mb-4 w-full px-2 sm:w-1/2">
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
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="latitude"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Latitude</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Latitude"
                              {...field}
                              value={field.value ?? ""}
                              type="number"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="longitude"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Longitude</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Longitude"
                              {...field}
                              value={field.value ?? ""}
                              type="number"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {/* Map shown inline on mobile, right after lat/lng fields */}
                  <div className="mb-4 h-[250px] w-full px-2 md:hidden">
                    <GoogleMapSimple
                      apiKey={googleApiKey}
                      onCenterChanged={(center) => {
                        form.setValue("latitude", center.lat.toString());
                        form.setValue("longitude", center.lng.toString());
                      }}
                      latitude={safeParseFloat(formLatitude)}
                      longitude={safeParseFloat(formLongitude)}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="addressStreet"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Street"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="addressStreet2"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street 2</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Street 2"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="addressCity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="City"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="addressState"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="State"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="addressZip"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Zip</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Zip"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-4 w-full px-2 sm:w-1/2">
                    <FormField
                      control={form.control}
                      name="addressCountry"
                      render={({ field }) => {
                        return (
                          <FormItem
                            key={`country-${String(field.value ?? "new")}`}
                          >
                            <FormLabel>Country</FormLabel>
                            <VirtualizedCombobox
                              value={field.value?.toString()}
                              options={
                                sortedCountries?.map((country) => ({
                                  value: country.code,
                                  label: country.name,
                                })) ?? []
                              }
                              searchPlaceholder="Select a country"
                              onSelect={(value) => {
                                const countryCode = value as string;
                                if (countryCode == null) {
                                  toast.error("Invalid country code");
                                  return;
                                }
                                field.onChange(countryCode);
                              }}
                              isMulti={false}
                            />
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  </div>

                  <div className="mb-4 w-full px-2 sm:w-1/2">
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
                          <FormControl>
                            <Textarea
                              {...field}
                              value={field.value ?? ""}
                              rows={5}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="w-full px-2">
                    <div className="flex flex-col space-y-2 pt-4 sm:flex-row sm:space-x-4 sm:space-y-0">
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
                  <div className="w-full px-2">
                    <div className="flex space-x-4 pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          closeModal();
                          openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                            id: location?.id ?? -1,
                            type: DeleteType.LOCATION,
                          });
                        }}
                        className="w-full"
                      >
                        Delete Location
                      </Button>
                    </div>
                  </div>
                  {!isProd && (
                    <div className="w-full px-2">
                      <div className="flex space-x-4 pt-4">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            form.setValue("name", "Fake Location");
                            form.setValue(
                              "regionId",
                              regions?.orgs?.find((r) => r.name === "Boone")
                                ?.id ?? 1,
                            );
                            form.setValue("email", "fake@example.com");
                            form.setValue("latitude", "37.7749");
                            form.setValue("longitude", "-122.4194");
                          }}
                          className="w-full"
                        >
                          (DEV) Fake data
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </Form>
          </div>
          {/* Map shown as right column on desktop */}
          <div className="hidden md:block md:w-1/2">
            <GoogleMapSimple
              apiKey={googleApiKey}
              onCenterChanged={(center) => {
                form.setValue("latitude", center.lat.toString());
                form.setValue("longitude", center.lng.toString());
              }}
              latitude={safeParseFloat(formLatitude)}
              longitude={safeParseFloat(formLongitude)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
