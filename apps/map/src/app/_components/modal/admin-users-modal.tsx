"use client";

import { UserPlus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
import type { UserRole } from "@acme/shared/app/enums";
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
import { toast } from "@acme/ui/toast";
import { CrupdateUserSchema } from "@acme/validators";

import gte from "lodash/gte";
import {
  ORPCError,
  invalidateQueries,
  orpc,
  useMutation,
  useQuery,
} from "~/orpc/react";
import type { DataType } from "~/utils/store/modal";
import { ModalType, closeModal, openModal } from "~/utils/store/modal";

export default function UserModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_USERS];
}) {
  const { data: session, update } = useSession();
  const { data: userResponse } = useQuery(
    orpc.user.byId.queryOptions({
      input: {
        id: data.id ?? -1,
        includePii: true, // Request PII to check if we have access
      },
      enabled: gte(data.id, 0),
    }),
  );

  const user = userResponse?.user;
  const hasPiiAccess = userResponse?.includePii ?? false;
  const router = useRouter();

  const form = useForm({
    schema: CrupdateUserSchema.extend({
      badImage: z.boolean().default(false),
    }),
    defaultValues: {
      id: user?.id ?? undefined,
      f3Name: user?.f3Name ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
      roles: user?.roles ?? [],
      status: user?.status ?? "active",
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        id: user.id ?? undefined,
        f3Name: user?.f3Name ?? "",
        firstName: user?.firstName ?? "",
        lastName: user?.lastName ?? "",
        email: user?.email ?? "",
        roles: user?.roles,
        status: user?.status ?? "active",
        phone: user?.phone ?? "",
      });
    }
  }, [form, user]);

  const crupdateUser = useMutation(
    orpc.user.crupdate.mutationOptions({
      onSuccess: async (data) => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "user",
        });
        const { roles } = data;
        if (session?.id === data.id && data.roles?.length > 0) {
          await update({ ...session, roles });
        }
        closeModal();
        toast.success("Successfully updated user");
        router.refresh();
      },
      onError: (err) => {
        if (err instanceof ORPCError) {
          toast.error(err.message);
        } else {
          toast.error(
            err instanceof ORPCError && err?.code === "UNAUTHORIZED"
              ? "You must be logged in to update users"
              : "Failed to update user",
          );
        }
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
            {user?.id ? "Edit" : "Add"} User
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              (data) => {
                // Only exclude PII fields when editing an existing user without PII access
                let submitData: typeof data;
                if (!hasPiiAccess && user?.id) {
                  // For updates without PII access, don't send PII fields
                  // Keep email (required by schema) but exclude other PII
                  const {
                    phone: _phone,
                    emergencyContact: _emergencyContact,
                    emergencyPhone: _emergencyPhone,
                    emergencyNotes: _emergencyNotes,
                    ...nonPiiData
                  } = data;
                  submitData = {
                    ...nonPiiData,
                    email: data.email ?? "", // Keep email as it's required by schema
                  } as typeof data;
                } else {
                  // For new users or users with PII access, send all data
                  submitData = data;
                }
                crupdateUser.mutate(submitData);
              },
              (error) => {
                toast.error("Failed to update user");
                console.log(error);
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
                  name="f3Name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>F3 Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="F3 Name"
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
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="First Name"
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
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Last Name"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {(hasPiiAccess || !user?.id) && (
                <>
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
                              type="email"
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
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Phone"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              <div className="mb-4 w-1/2 px-2">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
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
                    Save Changes
                  </Button>
                </div>
              </div>
              {user?.id && (
                <>
                  <div className="w-full border-t border-border" />
                  <div className="mb-4 w-full px-2">
                    <div className="flex flex-col gap-2 pt-4">
                      {user.roles && user.roles.length > 0 && (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Current Roles
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {user.roles.map(
                              (role: {
                                orgId: number;
                                orgName: string;
                                roleName: UserRole;
                              }) => {
                                const roleStyles = {
                                  admin:
                                    "bg-purple-100 text-purple-700 border-purple-200",
                                  editor:
                                    "bg-blue-100 text-blue-700 border-blue-200",
                                  user: "bg-green-100 text-green-700 border-green-200",
                                } as const;

                                const roleLabels = {
                                  admin: "Admin",
                                  editor: "Editor",
                                  user: "User",
                                } as const;

                                return (
                                  <span
                                    key={`${role.orgId}-${role.roleName}`}
                                    className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
                                      roleStyles[role.roleName]
                                    }`}
                                  >
                                    {role.orgName} ({roleLabels[role.roleName]})
                                  </span>
                                );
                              },
                            )}
                          </div>
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          openModal(ModalType.ADMIN_GRANT_ACCESS, {
                            userId: Number(user.id),
                          });
                        }}
                        className="w-full"
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        Manage Access
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        Progress here will be lost
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
