"use client";

import gte from "lodash/gte";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { AOInsertSchema } from "@acme/validators";

import { env } from "~/env";
import { invalidateQueries, orpc, useMutation, useQuery } from "~/orpc/react";
import type { DataType } from "~/utils/store/modal";
import {
  DeleteType,
  ModalType,
  closeModal,
  openModal,
} from "~/utils/store/modal";
import { VirtualizedCombobox } from "../virtualized-combobox";

export default function AdminAOsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_AOS];
}) {
  const { data: ao } = useQuery(
    orpc.org.byId.queryOptions({
      input: { id: data.id ?? -1, orgType: "ao" },
      enabled: gte(data.id, 0),
    }),
  );
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm({ schema: AOInsertSchema });

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
  }, [form, ao]);

  const crupdateAO = useMutation(orpc.org.crupdate.mutationOptions());

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
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
                await crupdateAO
                  .mutateAsync({ ...data, orgType: "ao" })
                  .then(() => {
                    void invalidateQueries(
                      orpc.org.all.queryOptions({
                        input: { orgTypes: ["ao"] },
                      }),
                    );
                    closeModal();
                    toast.success("Successfully updated ao");
                    router.refresh();
                  })
                  .catch((error) => {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Failed to update ao",
                    );
                  })
                  .finally(() => {
                    setIsSubmitting(false);
                  });
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
                    <FormItem key={`region-${field.value}`}>
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
              <div className="mb-4 flex w-full flex-col px-2">
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
                  {/* in dev mode, show a button to preload values */}
                  {env.NEXT_PUBLIC_CHANNEL !== "prod" ? (
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
                <div className="flex space-x-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    // variant="link"
                    onClick={() => {
                      closeModal();
                      openModal(ModalType.ADMIN_DELETE_CONFIRMATION, {
                        id: ao?.id ?? -1,
                        type: DeleteType.AO,
                      });
                    }}
                    className="w-full"
                  >
                    Delete AO
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
