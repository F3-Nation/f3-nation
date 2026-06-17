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
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
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
      phone: region?.phone ?? null,
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
      phone: region?.phone ?? null,
      twitter: region?.twitter ?? null,
      facebook: region?.facebook ?? null,
      instagram: region?.instagram ?? null,
      lastAnnualReview: region?.lastAnnualReview ?? null,
      meta: region?.meta ?? null,
    });
    setSelectedLogoFile(null);
    setLogoPreviewUrl(null);
  }, [form, region]);

  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  const crupdateRegion = useMutation(orpc.org.crupdate.mutationOptions());
  const isEditing = !!region?.id;
  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";
  const showDeactivateButton = isEditing && region?.isActive !== false;

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(
          `max-h-[90vh] max-w-[95%] overflow-y-auto rounded-lg sm:max-w-[90%] lg:max-w-[600px]`,
        )}
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
                  let orgId = data.id;

                  if (!orgId) {
                    const result = await crupdateRegion.mutateAsync({
                      ...data,
                      orgType: "region",
                    });
                    orgId = result.org?.id;
                  }

                  let logoUrl: string | undefined;

                  if (selectedLogoFile && orgId) {
                    setIsUploadingLogo(true);

                    logoUrl = await uploadLogo({
                      file: selectedLogoFile,
                      orgId,
                    });
                  }

                  await crupdateRegion.mutateAsync({
                    ...data,
                    id: orgId,
                    ...(logoUrl ? { logoUrl } : {}),
                    orgType: "region",
                  });

                  await invalidateQueries("org");
                  closeModal();
                  toast.success(`Successfully ${actionTextPast} region`);
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof ORPCError && error?.code === "UNAUTHORIZED"
                      ? `You are not authorized to ${actionText} this region`
                      : `Failed to ${actionText} region`,
                  );
                  console.error(error);
                } finally {
                  setIsUploadingLogo(false);
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
                  name="parentId"
                  render={({ field }) => (
                    <FormItem key={`area-${String(field.value ?? "new")}`}>
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
              <div className="mb-4 w-full px-2 sm:w-1/2">
                <div className="mb-3 text-sm font-medium text-black">Logo</div>
                <Controller
                  control={form.control}
                  name="logoUrl"
                  render={({ field: { value } }) => {
                    return (
                      <div className="flex flex-col items-center gap-2">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            const previewUrl = URL.createObjectURL(file);
                            setSelectedLogoFile(file);
                            setLogoPreviewUrl(previewUrl);
                          }}
                          disabled={isUploadingLogo}
                        />
                        {isUploadingLogo ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Spinner className="size-4" /> Uploading...
                          </div>
                        ) : (
                          (logoPreviewUrl ?? value) && (
                            <DebouncedImage
                              src={logoPreviewUrl ?? value ?? ""}
                              alt="Region Logo"
                              onImageFail={() =>
                                form.setValue("badImage", true)
                              }
                              onImageSuccess={() =>
                                form.setValue("badImage", false)
                              }
                            />
                          )
                        )}
                      </div>
                    );
                  }}
                />
                <p className="text-xs text-destructive">
                  {/* {form.formState.errors.aoLogo?.message} */}
                </p>
              </div>
              <div className="mb-4 w-full px-2 sm:w-1/2">
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
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Phone"
                          type="tel"
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
              <div className="mb-4 w-full px-2 sm:w-1/2">
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
              <div className="mb-4 w-full px-2 sm:w-1/2">
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
              <div className="mb-4 w-full px-2 sm:w-1/2">
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
              <div className="mb-4 w-full px-2">
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
                {showDeactivateButton && (
                  <div className="flex space-x-4 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        closeModal();
                        openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                          id: region?.id ?? -1,
                          type: DeleteType.REGION,
                        });
                      }}
                      className="w-full"
                    >
                      Deactivate Region
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
