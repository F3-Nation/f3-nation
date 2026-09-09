"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

import { Controller } from "react-hook-form";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { safeParseInt } from "@acme/shared/common/functions";
import { uploadLogo } from "~/utils/image/upload-logo";
import { DebouncedImage } from "../debounced-image";
import gte from "lodash/gte";
import { orgTypeDisplay } from "@acme/shared/app/org-hierarchy";
import { orgEditorConfig, orgEditorSchema } from "./org-editor-config";
import type { EditableOrgType } from "./org-editor-config";
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

export default function AdminOrgEditModal({
  orgType,
  id,
  isProd = true,
}: {
  orgType: EditableOrgType;
  id?: number | null;
  isProd?: boolean;
}) {
  const config = orgEditorConfig[orgType];
  const label = orgTypeDisplay[orgType].label;
  const parentLabel = config.parentType
    ? orgTypeDisplay[config.parentType].label
    : "";
  const schema = useMemo(() => orgEditorSchema(config), [config]);
  const fieldClass = config.compactLayout
    ? "mb-4 w-1/2 px-2"
    : "mb-4 w-full px-2 sm:w-1/2";
  const { data: orgResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: id ?? -1, orgType },
      enabled: gte(id, 0),
    }),
  );
  const org = orgResponse?.org;
  const { data: parents } = useQuery(
    orpc.org.all.queryOptions({
      input: { orgTypes: config.parentType ? [config.parentType] : [] },
      enabled: !!config.parentType,
    }),
  );
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const form = useForm({
    schema,
    defaultValues: {
      id: org?.id ?? undefined,
      name: org?.name ?? config.defaultName,
      ...(config.parentType ? { parentId: org?.parentId ?? -1 } : {}),
      defaultLocationId: org?.defaultLocationId ?? null,
      isActive: org?.isActive ?? true,
      description: org?.description ?? "",
      ...(config.retainLogo ? { logoUrl: org?.logoUrl ?? null } : {}),
      website: org?.website ?? null,
      email: org?.email ?? null,
      phone: org?.phone ?? null,
      twitter: org?.twitter ?? null,
      facebook: org?.facebook ?? null,
      instagram: org?.instagram ?? null,
      lastAnnualReview: org?.lastAnnualReview ?? null,
      meta: org?.meta ?? (config.defaultMetaNull ? null : {}),
      ...(config.logoPosition ? { badImage: false } : {}),
    },
  });

  useEffect(() => {
    form.reset({
      ...(config.retainLoadedFields ? org : {}),
      id: org?.id ?? undefined,
      name: org?.name ?? config.defaultName,
      ...(config.parentType ? { parentId: org?.parentId ?? -1 } : {}),
      defaultLocationId: org?.defaultLocationId ?? null,
      isActive: org?.isActive ?? true,
      description: org?.description ?? "",
      ...(config.retainLogo ? { logoUrl: org?.logoUrl ?? null } : {}),
      website: org?.website ?? null,
      email: org?.email ?? null,
      phone: org?.phone ?? null,
      twitter: org?.twitter ?? null,
      facebook: org?.facebook ?? null,
      instagram: org?.instagram ?? null,
      lastAnnualReview: org?.lastAnnualReview ?? null,
      meta: org?.meta ?? null,
    });
    setSelectedLogoFile(null);
    setLogoPreviewUrl(null);
  }, [form, org, config]);

  useEffect(
    () => () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    },
    [logoPreviewUrl],
  );

  const isEditing = !!org?.id;
  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";
  const showDeactivateButton =
    config.deactivate === "active"
      ? org?.id != null && org.isActive
      : config.deactivate === "existing" &&
        isEditing &&
        org?.isActive !== false;

  const onSuccess = async () => {
    const invalidation = invalidateQueries("org");
    if (!config.logoPosition || config.awaitInvalidation) await invalidation;
    closeModal();
    toast.success(
      `Successfully ${config.fixedUpdateSuccess ? "updated" : actionTextPast} ${orgType}`,
    );
    router.refresh();
  };
  const onError = (error: unknown) => {
    toast.error(
      config.rawErrorMessage
        ? error instanceof Error
          ? error.message
          : `Failed to update ${orgType}`
        : error instanceof ORPCError && error.code === "UNAUTHORIZED"
          ? `You are not authorized to ${actionText} this ${orgType}`
          : `Failed to ${actionText} ${orgType}`,
    );
  };
  const crupdateOrg = useMutation(
    orpc.org.crupdate.mutationOptions(
      config.logoPosition ? {} : { onSuccess, onError },
    ),
  );

  const logoField = (
    <div className={fieldClass}>
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
                    alt={`${label} Logo`}
                    onImageFail={() => form.setValue("badImage", true)}
                    onImageSuccess={() => form.setValue("badImage", false)}
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
  );

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(
          config.compactLayout
            ? "max-w-[90%] rounded-lg lg:max-w-[600px]"
            : "max-h-[90vh] max-w-[95%] overflow-y-auto rounded-lg sm:max-w-[90%] lg:max-w-[600px]",
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {org?.id ? "Edit" : "Add"} {label}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              async (data) => {
                setIsSubmitting(true);
                try {
                  const payload = {
                    ...data,
                    ...(!config.parentType ? { parentId: undefined } : {}),
                    orgType,
                  };
                  if (config.logoPosition) {
                    let orgId = data.id;
                    if (!orgId) {
                      const result = await crupdateOrg.mutateAsync(payload);
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
                    await crupdateOrg.mutateAsync({
                      ...payload,
                      id: orgId,
                      ...(logoUrl ? { logoUrl } : {}),
                    });
                    await onSuccess();
                  } else {
                    await crupdateOrg.mutateAsync(payload);
                  }
                } catch (error) {
                  if (config.logoPosition) onError(error);
                  if (config.submitErrorToast)
                    toast.error(`Failed to update ${orgType}`);
                } finally {
                  setIsUploadingLogo(false);
                  setIsSubmitting(false);
                }
              },
              () => {
                if (config.validationToast)
                  toast.error(`Failed to update ${orgType}`);
                setIsSubmitting(false);
              },
            )}
            className="space-y-4"
          >
            <div className="flex flex-wrap">
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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

              {config.parentType && (
                <div className={fieldClass}>
                  <FormField
                    control={form.control}
                    name="parentId"
                    render={({ field }) => (
                      <FormItem
                        key={`${config.parentType}-${String(field.value ?? "new")}`}
                      >
                        <FormLabel>{parentLabel}</FormLabel>
                        {config.parentControl === "combobox" ? (
                          <VirtualizedCombobox
                            value={field.value?.toString()}
                            options={
                              parents?.orgs
                                .filter(
                                  (org) => org.orgType === config.parentType,
                                )
                                .map((region) => ({
                                  value: region.id.toString(),
                                  label: region.name,
                                })) ?? []
                            }
                            searchPlaceholder={config.parentPlaceholder}
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
                        ) : (
                          <Select
                            value={field.value?.toString()}
                            onValueChange={(value) =>
                              field.onChange(Number(value))
                            }
                            defaultValue={field.value?.toString()}
                            data-testid={config.parentTestId}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={config.parentPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {parents?.orgs
                                ?.slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((parent) => (
                                  <SelectItem
                                    key={`${config.parentType}-${parent.id}`}
                                    value={parent.id.toString()}
                                  >
                                    {parent.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
              {config.logoPosition === "afterParent" && logoField}
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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
              <div className={fieldClass}>
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
              {config.locationDescription && (
                <div className={fieldClass}>
                  <FormField
                    control={form.control}
                    name="meta.region_location_short_description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Short Location Description</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Denver, CO"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
              <div className={fieldClass}>
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
              {config.logoPosition === "afterStatus" && logoField}
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
              <div
                className={
                  config.devFakeData
                    ? "mb-4 flex w-full flex-col px-2"
                    : "mb-4 w-full px-2"
                }
              >
                <div
                  className={
                    config.compactLayout
                      ? "flex space-x-4 pt-4"
                      : "flex flex-col space-y-2 pt-4 sm:flex-row sm:space-y-0 sm:space-x-4"
                  }
                >
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
                  {config.devFakeData && !isProd ? (
                    <Button
                      type="button"
                      className="w-full bg-black hover:bg-black/80"
                      onClick={() => {
                        form.setValue("name", `Fake ${label}`);
                        form.setValue(
                          "parentId",
                          parents?.orgs?.[
                            Math.floor(Math.random() * parents?.orgs.length)
                          ]?.id ?? -1,
                        );
                        form.setValue("website", `https://fake${orgType}.com`);
                        form.setValue("email", `fake${orgType}@example.com`);
                        form.setValue("twitter", `@fake${orgType}`);
                        form.setValue(
                          "facebook",
                          `https://facebook.com/fake${orgType}`,
                        );
                        form.setValue(
                          "instagram",
                          `https://instagram.com/fake${orgType}`,
                        );
                        form.setValue("lastAnnualReview", "2024-01-01");
                        form.setValue("isActive", true);
                        form.setValue(
                          "description",
                          `Fake ${label} description`,
                        );
                      }}
                    >
                      (DEV) Fake data
                    </Button>
                  ) : null}
                </div>
                {showDeactivateButton && (
                  <div className="flex space-x-4 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        closeModal();
                        openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                          id: org?.id ?? -1,
                          type: DeleteType.ORG,
                          orgType,
                        });
                      }}
                      className="w-full"
                    >
                      Deactivate {label}
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
