"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
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
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";
import { EventTagInsertSchema } from "@acme/validators";

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
import { VirtualizedCombobox } from "../virtualized-combobox";

const EventTagFormSchema = EventTagInsertSchema.extend({
  name: z.string().min(1, { message: "Name is required" }),
});
type EventTagFormValues = z.infer<typeof EventTagFormSchema>;

export default function AdminEventTagsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_EVENT_TAGS];
}) {
  const isEditId = typeof data.id === "number" && data.id >= 0;
  const { data: eventTagResponse } = useQuery(
    orpc.eventTag.byId.queryOptions({
      input: { id: data.id ?? -1 },
      enabled: isEditId,
    }),
  );
  const eventTag = eventTagResponse?.eventTag;
  const { data: regions } = useQuery(
    orpc.org.accessible.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const sortedRegions = useMemo(() => {
    return regions?.orgs.sort((a, b) => {
      return a.orgType.localeCompare(b.orgType) || a.name.localeCompare(b.name);
    });
  }, [regions]);
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    schema: EventTagFormSchema,
    defaultValues: {
      name: "",
      description: "",
      color: "",
      specificOrgId: undefined,
      isActive: true,
    } satisfies Partial<EventTagFormValues>,
  });

  useEffect(() => {
    form.reset({
      id: eventTag?.id,
      name: eventTag?.name ?? "",
      description: eventTag?.description ?? "",
      color: eventTag?.color ?? "",
      specificOrgId: eventTag?.specificOrgId ?? undefined,
      isActive: eventTag?.isActive ?? true,
    });
  }, [form, eventTag]);

  const isEditing = !!eventTag?.id;
  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";

  const crupdateEventTag = useMutation(
    orpc.eventTag.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("eventTag");
        closeModal();
        toast.success(`Successfully ${actionTextPast} event tag`);
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? err.message ??
                `You are not authorized to ${actionText} this event tag`
            : `Failed to ${actionText} event tag`,
        );
      },
    }),
  );

  const onSubmit = async (values: EventTagFormValues) => {
    setIsSubmitting(true);
    try {
      await crupdateEventTag.mutateAsync({
        id: values.id,
        name: values.name.trim(),
        description: values.description?.trim(),
        color: values.color?.trim(),
        specificOrgId: values.specificOrgId ?? null,
        isActive: values.isActive ?? true,
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
            {eventTag?.id ? "Edit" : "Add"} Event Tag
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <div className="flex flex-col gap-4 px-2">
            {isEditing ? (
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
            ) : null}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Tag name"
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
              name="specificOrgId"
              render={({ field }) => (
                <FormItem key={`region-${String(field.value ?? "new")}`}>
                  <FormLabel>Region scope (optional)</FormLabel>
                  <FormControl>
                    <VirtualizedCombobox
                      value={field.value?.toString()}
                      options={
                        sortedRegions?.map((org) => ({
                          value: org.id.toString(),
                          label:
                            org.orgType !== "region"
                              ? `${org.name} (${org.orgType})`
                              : org.name,
                        })) ?? []
                      }
                      searchPlaceholder="Nation-wide (no region)"
                      onSelect={(value) => {
                        if (typeof value === "string") {
                          const numberValue = safeParseInt(value);
                          if (numberValue === field.value) {
                            field.onChange(null);
                          } else {
                            field.onChange(safeParseInt(value));
                          }
                        } else {
                          field.onChange(null);
                        }
                      }}
                      isMulti={false}
                      hideClearButton
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Leave unset for a nation-wide tag, or pick a region to scope
                    the tag to that org.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="#336699"
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
                    <Textarea {...field} value={field.value ?? ""} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                  </FormControl>
                  <FormLabel className="!mt-0 font-normal">Active</FormLabel>
                </FormItem>
              )}
            />
            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:gap-4">
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
                  void form.handleSubmit(onSubmit)();
                }}
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
                    id: eventTag?.id ?? -1,
                    type: DeleteType.EVENT_TAG,
                  });
                }}
                className="w-full"
              >
                Delete tag
              </Button>
            ) : null}
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
