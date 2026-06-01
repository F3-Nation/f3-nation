"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";

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
import { ControlledSelect } from "@acme/ui/select";
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { PositionInsertSchema } from "@acme/validators";

import gte from "lodash/gte";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";
import { useAuth } from "~/utils/hooks/use-auth";
import type { DataType } from "~/utils/store/modal";
import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
} from "~/utils/store/modal";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

const ORG_TYPE_OPTIONS = [
  { label: "AO", value: "ao" },
  { label: "Region", value: "region" },
  { label: "Area", value: "area" },
  { label: "Sector", value: "sector" },
  { label: "Nation", value: "nation" },
] as const;

const NATIONAL_ORG_VALUE = "__national__";

type PositionInsertFormType = z.infer<typeof PositionInsertSchema>;

export default function AdminPositionsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_POSITIONS];
}) {
  const { isNationAdmin } = useAuth();
  const { data: positionResponse } = useQuery(
    orpc.position.byId.queryOptions({
      input: { id: data.id ?? -1 },
      enabled: gte(data.id, 0),
    }),
  );
  const position = positionResponse?.position;
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    schema: PositionInsertSchema,
  });

  useEffect(() => {
    const defaultOrgId = position
      ? (position.orgId ?? undefined)
      : data.defaultOrgId === null
        ? undefined
        : data.defaultOrgId;

    form.reset({
      id: position?.id,
      name: position?.name ?? "",
      description: position?.description ?? "",
      orgId: defaultOrgId,
      orgType: position?.orgType ?? undefined,
      isActive: position?.isActive ?? true,
    });
  }, [form, position, data.defaultOrgId]);

  const isEditing = !!position?.id;

  const selectedOrgType = form.watch("orgType");

  const { data: editableOrgsResponse } = useQuery(
    orpc.org.all.queryOptions({
      input: {
        orgTypes: selectedOrgType ? [selectedOrgType] : ["region"],
        onlyMine: true,
        pageSize: 1000,
      },
      enabled: !!selectedOrgType,
    }),
  );

  const prevOrgTypeRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (
      prevOrgTypeRef.current != null &&
      prevOrgTypeRef.current !== selectedOrgType
    ) {
      form.setValue("orgId", null, { shouldDirty: true });
    }
    prevOrgTypeRef.current = selectedOrgType;
  }, [selectedOrgType, form]);

  const orgOptions = useMemo(() => {
    const orgs = editableOrgsResponse?.orgs ?? [];
    const options: { value: string; label: string }[] = orgs.map((org) => ({
      value: org.id.toString(),
      label: org.name,
    }));

    if (isNationAdmin && selectedOrgType === "nation") {
      options.unshift({
        value: NATIONAL_ORG_VALUE,
        label: "National (no org)",
      });
    }

    if (
      position?.orgId != null &&
      position.orgName &&
      position.orgType === selectedOrgType &&
      !options.some((o) => o.value === position.orgId!.toString())
    ) {
      options.push({
        value: position.orgId.toString(),
        label: position.orgName,
      });
    }

    return options;
  }, [editableOrgsResponse, isNationAdmin, selectedOrgType, position]);

  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";
  const showDeleteButton = isEditing && position?.isActive !== false;

  const crupdatePosition = useMutation(
    orpc.position.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("position");
        closeModal();
        toast.success(`Successfully ${actionTextPast} position`);
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? `You are not authorized to ${actionText} this position`
            : `Failed to ${actionText} position`,
        );
      },
    }),
  );

  const onSubmit = async (values: PositionInsertFormType) => {
    if (values.orgId == null && !isNationAdmin) {
      toast.error(
        "Only F3 Nation admins can create national positions. Pick an organization.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await crupdatePosition.mutateAsync(values);
    } catch (error) {
      console.error("crupdatePosition", { error });
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = isEditing ? "Edit Position" : "Add Position";

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(
          `max-h-[90vh] max-w-[95%] overflow-y-auto rounded-lg sm:max-w-[90%] lg:max-w-[600px]`,
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-center">{title}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <div className="flex flex-wrap">
            <div className="mb-3 w-full px-2 md:w-1/2">
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
            <div className="mb-3 w-full px-2 md:w-1/2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Position name"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="mb-3 w-full px-2 md:w-1/2">
              <ControlledSelect
                control={form.control}
                label="Org Level"
                name="orgType"
                options={
                  isNationAdmin
                    ? [...ORG_TYPE_OPTIONS]
                    : ORG_TYPE_OPTIONS.filter((o) => o.value !== "nation")
                }
              />
            </div>
            <div className="mb-3 w-full px-2 md:w-1/2">
              <FormField
                control={form.control}
                name="orgId"
                render={({ field }) => {
                  const selectedValue =
                    field.value == null
                      ? isNationAdmin && selectedOrgType === "nation"
                        ? NATIONAL_ORG_VALUE
                        : undefined
                      : field.value.toString();

                  const placeholder = !selectedOrgType
                    ? "Pick an org level first"
                    : `Select a ${selectedOrgType}`;

                  return (
                    <FormItem
                      key={`org-${selectedOrgType ?? "none"}-${String(
                        field.value ?? "new",
                      )}`}
                    >
                      <FormLabel>Organization</FormLabel>
                      <VirtualizedCombobox
                        value={selectedValue}
                        options={orgOptions}
                        searchPlaceholder={placeholder}
                        disabled={!selectedOrgType}
                        hideClearButton={!isNationAdmin}
                        onSelect={(value) => {
                          const next = Array.isArray(value) ? value[0] : value;
                          if (
                            next == null ||
                            next === NATIONAL_ORG_VALUE ||
                            next === ""
                          ) {
                            field.onChange(null);
                            return;
                          }
                          const orgId = safeParseInt(next);
                          if (orgId == null) {
                            toast.error("Invalid organization");
                            return;
                          }
                          field.onChange(orgId);
                        }}
                        isMulti={false}
                      />
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            <div className="mb-3 w-full px-2">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <Textarea {...field} value={field.value ?? ""} rows={3} />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="mb-3 w-full px-2">
              <div className="mb-3 flex flex-col space-y-2 pt-3 sm:flex-row sm:space-x-4 sm:space-y-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => closeModal()}
                  className="w-full"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    void form.handleSubmit(onSubmit, (errors) => {
                      console.log(errors);
                      toast.error(`Failed to ${actionText} position`);
                    })();
                  }}
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      Saving... <Spinner className="size-4" />
                    </div>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
              {showDeleteButton && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    closeModal();
                    openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                      id: position?.id ?? -1,
                      type: DeleteType.POSITION,
                    });
                  }}
                  className="w-full"
                >
                  Delete Position
                </Button>
              )}
            </div>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
