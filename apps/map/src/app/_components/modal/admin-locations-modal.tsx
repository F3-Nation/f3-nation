"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { z } from "zod";

import { COUNTRIES, DEFAULT_CENTER, Z_INDEX } from "@acme/shared/app/constants";
import { isProd } from "@acme/shared/common/constants";
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

import type { DataType } from "~/utils/store/modal";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
} from "~/utils/store/modal";
import { GoogleMapSimple } from "../map/google-map-simple";
import { VirtualizedCombobox } from "../virtualized-combobox";

export default function AdminLocationsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_LOCATIONS];
}) {
  const { data: location } = useQuery(
    orpc.location.byId.queryOptions({ input: { id: data.id ?? -1 } }),
  );
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

  const crupdateLocation = useMutation(
    orpc.location.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "location",
        });
        closeModal();
        toast.success("Successfully updated location");
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? "You must be logged in to update users"
            : "Failed to update user",
        );
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
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[1024px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {location?.id ? "Edit" : "Add"} Location
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap">
          Locations are the the placements of workouts. They are grouped by
          regions.
          <div className="w-1/2">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(
                  async (data) => {
                    setIsSubmitting(true);
                    try {
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
                    } catch (error) {
                      toast.error("Failed to update location");
                      console.error(error);
                    } finally {
                      setIsSubmitting(false);
                    }
                  },
                  (error) => {
                    toast.error("Failed to update location");
                    console.log(error);
                    setIsSubmitting(false);
                  },
                )}
                className="space-y-4"
              >
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
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger type="button">
                                <CircleHelp
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
                  <div className="mb-4 w-1/2 px-2">
                    <FormField
                      control={form.control}
                      name="regionId"
                      render={({ field }) => (
                        <FormItem key={`region-${field.value}`}>
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
                  <div className="mb-4 w-1/2 px-2">
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
                  <div className="mb-4 w-1/2 px-2">
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
                  <div className="mb-4 w-1/2 px-2">
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
                  <div className="mb-4 w-1/2 px-2">
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
                  <div className="mb-4 w-1/2 px-2">
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
                  <div className="mb-4 w-1/2 px-2">
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
                  <div className="mb-4 w-1/2 px-2">
                    <FormField
                      control={form.control}
                      name="addressCountry"
                      render={({ field }) => {
                        return (
                          <FormItem key={`country-${field.value}`}>
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
          <div className="w-1/2">
            <GoogleMapSimple
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
