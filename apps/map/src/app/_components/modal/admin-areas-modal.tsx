"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { AreaInsertSchema } from "@acme/validators";
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

export default function AdminAreasModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_AREAS];
}) {
  const { data: areaResponse } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: data.id ?? -1, orgType: "area" },
      enabled: gte(data.id, 0),
    }),
  );
  const area = areaResponse?.org;
  const { data: sectors } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["sector"] } }),
  );
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm({
    schema: AreaInsertSchema,
    defaultValues: {
      id: area?.id ?? undefined,
      name: area?.name ?? "",
      parentId: area?.parentId ?? -1,
      defaultLocationId: area?.defaultLocationId ?? null,
      isActive: area?.isActive ?? true,
      description: area?.description ?? "",
      logoUrl: area?.logoUrl ?? null,
      website: area?.website ?? null,
      email: area?.email ?? null,
      twitter: area?.twitter ?? null,
      facebook: area?.facebook ?? null,
      instagram: area?.instagram ?? null,
      lastAnnualReview: area?.lastAnnualReview ?? null,
      meta: area?.meta ?? {},
    },
  });

  useEffect(() => {
    form.reset({
      id: area?.id ?? undefined,
      name: area?.name ?? "",
      parentId: area?.parentId ?? -1,
      defaultLocationId: area?.defaultLocationId ?? null,
      isActive: area?.isActive ?? true,
      description: area?.description ?? "",
      logoUrl: area?.logoUrl ?? null,
      website: area?.website ?? null,
      email: area?.email ?? null,
      twitter: area?.twitter ?? null,
      facebook: area?.facebook ?? null,
      instagram: area?.instagram ?? null,
      lastAnnualReview: area?.lastAnnualReview ?? null,
      meta: area?.meta ?? null,
    });
  }, [form, area]);

  const crupdateArea = useMutation(
    orpc.org.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "org",
        });
        closeModal();
        toast.success("Successfully updated area");
        router.refresh();
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? "You must be logged in to update areas"
            : "Failed to update area",
        );
      },
    }),
  );

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {area?.id ? "Edit" : "Add"} Area
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              async (data) => {
                setIsSubmitting(true);
                try {
                  await crupdateArea.mutateAsync({ ...data, orgType: "area" });
                } catch (error) {
                  toast.error("Failed to update area");
                  console.error(error);
                } finally {
                  setIsSubmitting(false);
                }
              },
              (error) => {
                toast.error("Failed to update area");
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
                    <FormItem key={`sector-${field.value}`}>
                      <FormLabel>Sector</FormLabel>
                      <Select
                        value={field.value?.toString()}
                        onValueChange={(value) => field.onChange(Number(value))}
                        defaultValue={field.value?.toString()}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a sector" />
                        </SelectTrigger>
                        <SelectContent>
                          {sectors?.orgs
                            ?.slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((sector) => (
                              <SelectItem
                                key={`sector-${sector.id}`}
                                value={sector.id.toString()}
                              >
                                {sector.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                        id: area?.id ?? -1,
                        type: DeleteType.AREA,
                      });
                    }}
                    className="w-full"
                  >
                    Delete Area
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
