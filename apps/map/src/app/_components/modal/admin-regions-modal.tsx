"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
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
import { RegionInsertSchema } from "@acme/validators";

import gte from "lodash/gte";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import { scaleAndCropImage } from "~/utils/image/scale-and-crop-image";
import { uploadLogo } from "~/utils/image/upload-logo";
import type { DataType } from "~/utils/store/modal";
import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
} from "~/utils/store/modal";
import { DebouncedImage } from "../debounced-image";

export default function AdminRegionsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_REGIONS];
}) {
  const { data: regionResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: data.id ?? -1, orgType: "region" },
      enabled: gte(data.id, 0),
    }),
  );
  const region = regionResponse?.org;
  const { data: areas } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["area"] } }),
  );
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm({
    schema: RegionInsertSchema.extend({
      badImage: z.boolean().default(false),
    }),
    defaultValues: {
      id: region?.id ?? undefined,
      name: region?.name ?? "",
      parentId: region?.parentId ?? -1,
      defaultLocationId: region?.defaultLocationId ?? null,
      isActive: region?.isActive ?? true,
      description: region?.description ?? "",
      logoUrl: region?.logoUrl ?? null,
      website: region?.website ?? null,
      email: region?.email ?? null,
      twitter: region?.twitter ?? null,
      facebook: region?.facebook ?? null,
      instagram: region?.instagram ?? null,
      lastAnnualReview: region?.lastAnnualReview ?? null,
      meta: region?.meta ?? {},
      badImage: false,
    },
  });

  useEffect(() => {
    form.reset({
      id: region?.id ?? undefined,
      name: region?.name ?? "",
      parentId: region?.parentId ?? -1,
      defaultLocationId: region?.defaultLocationId ?? null,
      isActive: region?.isActive ?? true,
      description: region?.description ?? "",
      logoUrl: region?.logoUrl ?? null,
      website: region?.website ?? null,
      email: region?.email ?? null,
      twitter: region?.twitter ?? null,
      facebook: region?.facebook ?? null,
      instagram: region?.instagram ?? null,
      lastAnnualReview: region?.lastAnnualReview ?? null,
      meta: region?.meta ?? null,
    });
  }, [form, region]);

  const crupdateRegion = useMutation(
    orpc.org.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "org",
        });
        closeModal();
        toast.success("Successfully updated region");
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          // ORPCError code = "UNAUTHORIZED", message, data
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? "You must be logged in to update regions"
            : "Failed to update region",
        );
      },
    }),
  );

  const formRegionId = form.watch("id");

  const generateRandomString = (length: number) => {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length),
      );
    }
    return result;
  };
  const formId = generateRandomString(10);

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {region?.id ? "Edit" : "Add"} Region
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              async (data) => {
                setIsSubmitting(true);
                try {
                  await crupdateRegion.mutateAsync({
                    ...data,
                    orgType: "region",
                  });
                } catch (error) {
                  toast.error("Failed to update region");
                  console.error(error);
                } finally {
                  setIsSubmitting(false);
                }
              },
              (error) => {
                toast.error("Failed to update region");
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
                  name="parentId"
                  render={({ field }) => (
                    <FormItem key={`area-${field.value}`}>
                      <FormLabel>Area</FormLabel>
                      <Select
                        value={field.value?.toString()}
                        onValueChange={(value) => field.onChange(Number(value))}
                        defaultValue={field.value?.toString()}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an area" />
                        </SelectTrigger>
                        <SelectContent>
                          {areas?.orgs
                            ?.slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((area) => (
                              <SelectItem
                                key={`area-${area.id}`}
                                value={area.id.toString()}
                              >
                                {area.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="w- mb-4 w-1/2 px-2">
                <div className="mb-3 text-sm font-medium text-black">Logo</div>
                <Controller
                  control={form.control}
                  name="logoUrl"
                  render={({ field: { onChange, value } }) => {
                    return (
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            if (!formRegionId) return;
                            console.log("files", e.target.files);
                            const file = e.target.files?.[0];
                            if (!file) return;

                            const blob640 = await scaleAndCropImage(
                              file,
                              640,
                              640,
                            );
                            if (!blob640) return;
                            const url640 = await uploadLogo({
                              file: blob640,
                              regionId: formRegionId,
                              requestId: formId,
                            });
                            onChange(url640);
                            const blob64 = await scaleAndCropImage(
                              file,
                              64,
                              64,
                            );
                            if (blob64) {
                              void uploadLogo({
                                file: blob64,
                                regionId: formRegionId,
                                requestId: formId,
                                size: 64,
                              });
                            }
                          }}
                          disabled={
                            typeof formRegionId !== "number" ||
                            formRegionId <= -1
                          }
                          className="flex-1"
                        />
                        {value && (
                          <DebouncedImage
                            src={value}
                            alt="AO Logo"
                            onImageFail={() => form.setValue("badImage", true)}
                            onImageSuccess={() =>
                              form.setValue("badImage", false)
                            }
                          />
                        )}
                      </div>
                    );
                  }}
                />
                <p className="text-xs text-destructive">
                  {/* {form.formState.errors.aoLogo?.message} */}
                </p>
              </div>
              <div className="mb-4 w-1/2 px-2">
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Website"
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Email"
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
                  name="twitter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Twitter</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Twitter"
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
                  name="facebook"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Facebook</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Facebook"
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
                  name="instagram"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instagram</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Instagram"
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
                  name="lastAnnualReview"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Annual Review</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Last Annual Review"
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
                <div className="flex space-x-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    // variant="link"
                    onClick={() => {
                      closeModal();
                      openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                        id: region?.id ?? -1,
                        type: DeleteType.REGION,
                      });
                    }}
                    className="w-full"
                  >
                    Delete Region
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
