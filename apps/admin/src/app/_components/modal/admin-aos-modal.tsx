"use client";

import gte from "lodash/gte";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
import { safeParseInt } from "@acme/shared/common/functions";
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
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { AOInsertSchema } from "@acme/validators";

import { invalidateQueries, orpc, useMutation, useQuery } from "~/orpc/react";
import { uploadLogo } from "~/utils/image/upload-logo";
import type { DataType } from "~/utils/store/modal";
import {
  DeleteType,
  ModalType,
  closeModal,
  openModal,
} from "~/utils/store/modal";
import { DebouncedImage } from "../debounced-image";

export default function AdminAOsModal({
  data,
  isProd,
}: {
  data: DataType[ModalType.ADMIN_AOS];
  isProd: boolean;
}) {
  const { data: aoResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: data.id ?? -1, orgType: "ao" },
      enabled: gte(data.id, 0),
    }),
  );
  const ao = aoResponse?.org;
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const form = useForm({
    schema: AOInsertSchema.extend({
      badImage: z.boolean().default(false),
    }),
    defaultValues: {
      id: ao?.id ?? undefined,
      name: ao?.name ?? "",
      parentId: ao?.parentId ?? -1,
      defaultLocationId: ao?.defaultLocationId ?? null,
      isActive: ao?.isActive ?? true,
      description: ao?.description ?? "",
      logoUrl: ao?.logoUrl ?? null,
      website: ao?.website ?? null,
      email: ao?.email ?? null,
      twitter: ao?.twitter ?? null,
      facebook: ao?.facebook ?? null,
      instagram: ao?.instagram ?? null,
      lastAnnualReview: ao?.lastAnnualReview ?? null,
      meta: ao?.meta ?? null,
      badImage: false,
    },
  });

  useEffect(() => {
    form.reset({
      ...ao,
      id: ao?.id ?? undefined,
      name: ao?.name ?? "",
      parentId: ao?.parentId ?? -1,
      defaultLocationId: ao?.defaultLocationId ?? null,
      isActive: ao?.isActive ?? true,
      description: ao?.description ?? "",
      logoUrl: ao?.logoUrl ?? null,
      website: ao?.website ?? null,
      email: ao?.email ?? null,
      twitter: ao?.twitter ?? null,
      facebook: ao?.facebook ?? null,
      instagram: ao?.instagram ?? null,
      lastAnnualReview: ao?.lastAnnualReview ?? null,
      meta: ao?.meta ?? null,
    });
    setSelectedLogoFile(null);
    setLogoPreviewUrl(null);
  }, [form, ao]);

  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  const crupdateAO = useMutation(orpc.org.crupdate.mutationOptions());
  const showDeactivateButton = ao?.id != null && ao.isActive;

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(
          `max-w-[95%] rounded-lg sm:max-w-[90%] lg:max-w-[600px] max-h-[90vh] overflow-y-auto`,
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {ao?.id ? "Edit" : "Add"} AO
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
                    const result = await crupdateAO.mutateAsync({
                      ...data,
                      orgType: "ao",
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

                  await crupdateAO.mutateAsync({
                    ...data,
                    id: orgId,
                    ...(logoUrl ? { logoUrl } : {}),
                    orgType: "ao",
                  });

                  void invalidateQueries("org");
                  closeModal();
                  toast.success("Successfully updated ao");
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Failed to update ao",
                  );
                } finally {
                  setIsUploadingLogo(false);
                  setIsSubmitting(false);
                }
              },
              (error) => {
                toast.error("Failed to update ao");
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
                    <FormItem key={`region-${String(field.value ?? "new")}`}>
                      <FormLabel>Region</FormLabel>
                      <VirtualizedCombobox
                        value={field.value?.toString()}
                        options={
                          regions?.orgs
                            .filter((org) => org.orgType === "region")
                            .map((region) => ({
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
                              alt="AO Logo"
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
              <div className="mb-4 flex w-full flex-col px-2">
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
                  {/* in dev mode, show a button to preload values */}
                  {!isProd ? (
                    <Button
                      type="button"
                      className="w-full bg-black hover:bg-black/80"
                      onClick={() => {
                        form.setValue("name", "Fake AO");
                        form.setValue(
                          "parentId",
                          regions?.orgs?.[
                            Math.floor(Math.random() * regions?.orgs.length)
                          ]?.id ?? -1,
                        );
                        form.setValue("website", "https://fakeao.com");
                        form.setValue("email", "fakeao@example.com");
                        form.setValue("twitter", "@fakeao");
                        form.setValue(
                          "facebook",
                          "https://facebook.com/fakeao",
                        );
                        form.setValue(
                          "instagram",
                          "https://instagram.com/fakeao",
                        );
                        form.setValue("lastAnnualReview", "2024-01-01");
                        form.setValue("isActive", true);
                        form.setValue("description", "Fake AO description");
                      }}
                    >
                      (DEV) Fake data
                    </Button>
                  ) : null}
                </div>
                {showDeactivateButton ? (
                  <div className="flex space-x-4 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        closeModal();
                        openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                          id: ao.id,
                          type: DeleteType.AO,
                        });
                      }}
                      className="w-full"
                    >
                      Deactivate AO
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
