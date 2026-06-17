"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";
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
import { SectorInsertSchema } from "@acme/validators";

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

export default function AdminSectorsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_SECTORS];
}) {
  const { data: sectorResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: data.id ?? -1, orgType: "sector" },
      enabled: gte(data.id, 0),
    }),
  );
  const sector = sectorResponse?.org;
  const { data: nations } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["nation"] } }),
  );
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm({
    schema: SectorInsertSchema,
    defaultValues: {
      id: sector?.id ?? undefined,
      name: sector?.name ?? "Unknown",
      parentId: sector?.parentId ?? -1,
      defaultLocationId: sector?.defaultLocationId ?? null,
      isActive: sector?.isActive ?? true,
      description: sector?.description ?? "",
      website: sector?.website ?? null,
      email: sector?.email ?? null,
      phone: sector?.phone ?? null,
      twitter: sector?.twitter ?? null,
      facebook: sector?.facebook ?? null,
      instagram: sector?.instagram ?? null,
      lastAnnualReview: sector?.lastAnnualReview ?? null,
      meta: sector?.meta ?? {},
    },
  });

  useEffect(() => {
    form.reset({
      id: sector?.id ?? undefined,
      name: sector?.name ?? "Unknown",
      parentId: sector?.parentId ?? -1,
      defaultLocationId: sector?.defaultLocationId ?? null,
      isActive: sector?.isActive ?? true,
      description: sector?.description ?? "",
      website: sector?.website ?? null,
      email: sector?.email ?? null,
      phone: sector?.phone ?? null,
      twitter: sector?.twitter ?? null,
      facebook: sector?.facebook ?? null,
      instagram: sector?.instagram ?? null,
      lastAnnualReview: sector?.lastAnnualReview ?? null,
      meta: sector?.meta ?? null,
    });
  }, [form, sector]);

  const isEditing = !!sector?.id;
  const actionText = isEditing ? "update" : "add";
  const actionTextPast = isEditing ? "updated" : "added";
  const showDeactivateButton = isEditing && sector?.isActive !== false;

  const crupdateSector = useMutation(
    orpc.org.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("org");
        closeModal();
        toast.success(`Successfully ${actionTextPast} sector`);
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? `You are not authorized to ${actionText} this sector`
            : `Failed to ${actionText} sector`,
        );
        setIsSubmitting(false);
      },
    }),
  );

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
            {sector?.id ? "Edit" : "Add"} Sector
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (data) => {
              setIsSubmitting(true);
              await crupdateSector.mutateAsync({
                ...data,
                orgType: "sector",
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
                    <FormItem key={`nation-${String(field.value ?? "new")}`}>
                      <FormLabel>Nation</FormLabel>
                      <Select
                        value={field.value?.toString()}
                        onValueChange={(value) => field.onChange(Number(value))}
                        defaultValue={field.value?.toString()}
                        data-testid={TestId.SECTOR_NATION_SELECT}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a nation" />
                        </SelectTrigger>
                        <SelectContent>
                          {nations?.orgs
                            ?.slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((nation) => (
                              <SelectItem
                                key={`nation-${nation.id}`}
                                value={nation.id.toString()}
                              >
                                {nation.name}
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
                          id: sector?.id ?? -1,
                          type: DeleteType.SECTOR,
                        });
                      }}
                      className="w-full"
                    >
                      Deactivate Sector
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
