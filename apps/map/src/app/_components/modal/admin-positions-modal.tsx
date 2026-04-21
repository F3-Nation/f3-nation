"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { z } from "zod";

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
import type { DataType } from "~/utils/store/modal";
import { useAuth } from "~/utils/hooks/use-auth";
import {
  closeModal,
  DeleteType,
  ModalType,
  openModal,
} from "~/utils/store/modal";

const ORG_TYPE_OPTIONS = [
  { label: "AO", value: "ao" },
  { label: "Region", value: "region" },
  { label: "Area", value: "area" },
  { label: "Sector", value: "sector" },
  { label: "Nation", value: "nation" },
] as const;

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

  const isNational = position?.orgId === null || position?.orgId === undefined;
  const isReadOnly = isNational && !isNationAdmin && !!position;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    schema: PositionInsertSchema,
  });

  useEffect(() => {
    form.reset({
      id: position?.id,
      name: position?.name ?? "",
      description: position?.description ?? "",
      orgId: position?.orgId ?? undefined,
      orgType: position?.orgType ?? undefined,
      isActive: position?.isActive ?? true,
    });
  }, [form, position]);

  const isEditing = !!position?.id;
  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";

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
            ? err.message ??
                `You are not authorized to ${actionText} this position`
            : `Failed to ${actionText} position`,
        );
      },
    }),
  );

  const onSubmit = async (data: PositionInsertFormType) => {
    setIsSubmitting(true);
    try {
      await crupdatePosition.mutateAsync(data);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = isReadOnly
    ? "View Position"
    : isEditing
      ? "Edit Position"
      : "Add Position";

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

        {isReadOnly && (
          <p className="text-center text-sm text-muted-foreground">
            National positions can only be edited by F3 Nation admins.
          </p>
        )}

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
                        disabled={isReadOnly}
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
                options={[...ORG_TYPE_OPTIONS]}
                disabled={isReadOnly}
              />
            </div>
            <div className="mb-3 w-full px-2">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={3}
                      disabled={isReadOnly}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="mb-3 w-full px-2">
              {!isReadOnly && (
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
              )}
              {isReadOnly && (
                <div className="pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => closeModal()}
                    className="w-full"
                  >
                    Close
                  </Button>
                </div>
              )}
              {!isReadOnly && isEditing && (
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
