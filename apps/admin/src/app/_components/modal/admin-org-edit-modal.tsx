"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { IsActiveStatus } from "@acme/shared/app/enums";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
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
  const { parentTypes } = config;
  const hasParent = parentTypes.length > 0;
  const isRegionEditor = orgType === "region";
  const isEditingRegion = isRegionEditor && id != null && id >= 0;
  const parentLabel = parentTypes
    .map((parentType) => orgTypeDisplay[parentType].label)
    .join(" or ");
  const schema = useMemo(() => orgEditorSchema(config), [config]);
  const fieldClass = config.compactLayout
    ? "mb-4 w-1/2 px-2"
    : "mb-4 w-full px-2 sm:w-1/2";
  const {
    data: orgResponse,
    isPending: orgPending,
    isError: orgError,
  } = useQuery({
    ...orpc.org.byId.queryOptions({
      input: { id: id ?? -1, orgType },
      enabled: gte(id, 0),
    }),
    ...(isRegionEditor ? { throwOnError: false } : {}),
  });
  const org = orgResponse?.org;
  const {
    data: sourceAccess,
    isPending: sourceAccessPending,
    isError: sourceAccessError,
  } = useQuery({
    ...orpc.request.canEditRegions.queryOptions({
      input: { orgIds: id != null ? [id] : [] },
      enabled: isEditingRegion,
    }),
    throwOnError: false,
  });
  const regionRecordUnavailable = isEditingRegion && !org;
  const sourceAccessDenied =
    isEditingRegion && sourceAccess?.results[0]?.success === false;
  const canChangeRegionParent =
    !isEditingRegion ||
    (!regionRecordUnavailable &&
      !sourceAccessPending &&
      !sourceAccessError &&
      sourceAccess?.results[0]?.success === true);
  const { data: currentParentResponse, isPending: currentParentPending } =
    useQuery({
      ...orpc.org.byId.queryOptions({
        input: { id: org?.parentId ?? -1 },
        enabled: isRegionEditor && org?.parentId != null,
      }),
      throwOnError: false,
    });
  const {
    data: parents,
    isPending: parentsPending,
    isError: parentsError,
  } = useFetchAllPages({
    path: ["org", "all"],
    queryKey: ["org.all.everyParent", parentTypes, isRegionEditor],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.all({
        orgTypes: parentTypes,
        ...(isRegionEditor ? { statuses: IsActiveStatus, onlyMine: true } : {}),
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
    enabled: hasParent,
  });
  const router = useRouter();
  const currentParent = currentParentResponse?.org;
  const parentOptions = (parents ?? [])
    .filter(
      (parent) =>
        !isRegionEditor || parent.isActive || parent.id === org?.parentId,
    )
    .map(({ id, name, orgType, isActive }) => ({
      id,
      name,
      orgType,
      isActive,
    }));
  if (
    isRegionEditor &&
    currentParent &&
    parentTypes.includes(currentParent.orgType) &&
    !parentOptions.some((parent) => parent.id === currentParent.id)
  ) {
    // Keeping the existing parent requires source access only, even when that
    // parent is inactive or outside the caller's editable destination scope.
    parentOptions.push(currentParent);
  }
  parentOptions.sort((a, b) => a.name.localeCompare(b.name));
  const hasAlternativeParent = parents?.some(
    (parent) => parent.isActive && parent.id !== org?.parentId,
  );
  const parentChangeDisabled =
    isRegionEditor &&
    (!canChangeRegionParent ||
      parentsPending ||
      parentsError ||
      !hasAlternativeParent);
  const regionRecordMessage =
    !org && orgError
      ? "Unable to load this Region. Try again before saving."
      : orgPending
        ? "Loading Region details. Wait before saving."
        : "This Region could not be found. Reload before saving.";
  let parentHelp: string | undefined;
  if (isRegionEditor) {
    if (regionRecordUnavailable) {
      parentHelp = regionRecordMessage;
    } else if (sourceAccessDenied) {
      parentHelp =
        "You need editor or admin access to this Region to change its parent.";
    } else if (isEditingRegion && sourceAccessError) {
      parentHelp =
        "Unable to verify Region access. You can save other changes with the current parent; parent changes are unavailable.";
    } else if (isEditingRegion && sourceAccessPending) {
      parentHelp =
        "Checking Region access. You can save other changes with the current parent; parent changes are unavailable.";
    } else if (parentsError) {
      parentHelp =
        "Unable to load editable parent choices. Try again before changing the parent.";
    } else if (parentsPending) {
      parentHelp = "Loading editable parent choices...";
    } else if (!hasAlternativeParent) {
      parentHelp = isEditingRegion
        ? "No other editable Area or Territory is available. The current parent is retained, and you can save other Region details."
        : "No active editable Area or Territory is available.";
    } else {
      parentHelp =
        "You can change the parent to an Area or Territory where you have editor or admin access.";
    }
  }
  const renderParentItem = (parent: (typeof parentOptions)[number]) => (
    <SelectItem
      key={`${parent.orgType}-${parent.id}`}
      value={parent.id.toString()}
    >
      {parent.name}
    </SelectItem>
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const form = useForm({
    schema,
    defaultValues: {
      id: org?.id ?? undefined,
      name: org?.name ?? config.defaultName,
      ...(hasParent ? { parentId: org?.parentId ?? -1 } : {}),
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
    // Preserve the original editors' reset contract: missing metadata becomes
    // null, even where the initial default is {}. React Hook Form creates an
    // object when a nested metadata field is edited. Logo editors omit
    // badImage here; their schema supplies false on submission when absent.
    form.reset({
      ...(config.retainLoadedFields ? org : {}),
      id: org?.id ?? undefined,
      name: org?.name ?? config.defaultName,
      ...(config.parentTypes.length > 0
        ? { parentId: org?.parentId ?? -1 }
        : {}),
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
            {org?.id || isEditingRegion ? "Edit" : "Add"} {label}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              async (data) => {
                if (isRegionEditor) {
                  if (regionRecordUnavailable) {
                    toast.error(regionRecordMessage);
                    return;
                  }
                  if (isEditingRegion && data.id !== org?.id) {
                    toast.error(
                      "Region details are not ready. Reload before saving.",
                    );
                    return;
                  }
                  if (sourceAccessDenied) {
                    toast.error("You are not authorized to update this region");
                    return;
                  }
                  // Let the API check unchanged-parent updates if the advisory
                  // source lookup is unavailable. Moves need verified access.
                  if (!isEditingRegion || data.parentId !== org?.parentId) {
                    if (!canChangeRegionParent) {
                      toast.error(
                        "Region access must be verified before changing the parent",
                      );
                      return;
                    }
                    if (parentsError || parentsPending) {
                      toast.error(
                        "Unable to load editable parent choices. Try again before changing the parent.",
                      );
                      return;
                    }
                    if (
                      !parents?.some(
                        (parent) =>
                          parent.id === data.parentId && parent.isActive,
                      )
                    ) {
                      toast.error(
                        "You need editor or admin access to the selected Area or Territory",
                      );
                      return;
                    }
                  }
                }
                setIsSubmitting(true);
                try {
                  const payload = {
                    ...data,
                    ...(!hasParent ? { parentId: undefined } : {}),
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

              {hasParent && (
                <div className={fieldClass}>
                  <FormField
                    control={form.control}
                    name="parentId"
                    render={({ field }) => (
                      <FormItem
                        key={`${parentTypes.join("-")}-${String(field.value ?? "new")}`}
                      >
                        <FormLabel>{parentLabel}</FormLabel>
                        {config.parentControl === "combobox" ? (
                          <VirtualizedCombobox
                            value={field.value?.toString()}
                            options={
                              parents
                                ?.filter((org) =>
                                  parentTypes.includes(org.orgType),
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
                            disabled={parentChangeDisabled}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={config.parentPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {isEditingRegion &&
                                org?.parentId != null &&
                                !parentOptions.some(
                                  (parent) => parent.id === org.parentId,
                                ) && (
                                  <SelectItem value={org.parentId.toString()}>
                                    {currentParentPending
                                      ? "Loading current parent…"
                                      : "Current parent"}
                                  </SelectItem>
                                )}
                              {parentTypes.length > 1
                                ? parentTypes.map((parentType) => {
                                    const group = parentOptions.filter(
                                      (parent) => parent.orgType === parentType,
                                    );
                                    if (group.length === 0) return null;
                                    return (
                                      <SelectGroup key={parentType}>
                                        <SelectLabel>
                                          {
                                            orgTypeDisplay[parentType]
                                              .pluralLabel
                                          }
                                        </SelectLabel>
                                        {group.map(renderParentItem)}
                                      </SelectGroup>
                                    );
                                  })
                                : parentOptions.map(renderParentItem)}
                            </SelectContent>
                          </Select>
                        )}
                        {isRegionEditor && (
                          <p className="text-sm text-muted-foreground">
                            {parentHelp}
                          </p>
                        )}
                        {isEditingRegion &&
                          !regionRecordUnavailable &&
                          !sourceAccessDenied &&
                          org?.parentId != null &&
                          field.value !== org.parentId && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isSubmitting}
                              onClick={() => field.onChange(org.parentId)}
                            >
                              Keep current parent
                            </Button>
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
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      isRegionEditor &&
                      (regionRecordUnavailable || sourceAccessDenied)
                    }
                  >
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
                          parents?.[
                            Math.floor(Math.random() * (parents?.length ?? 0))
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
