"use client";

import { UserPlus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
import type { UserRole } from "@acme/shared/app/enums";
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
import { toast } from "@acme/ui/toast";
import { CrupdateUserSchema } from "@acme/validators";

import gte from "lodash/gte";
import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
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
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );

  // Get orgs where user has admin role (required to manage access)
  const { data: accessibleOrgsData } = useQuery(
    orpc.org.accessible.queryOptions({
      input: {
        orgTypes: ["region", "area", "sector", "nation"],
      },
    }),
  );

  // Filter to only orgs where user is admin (or all orgs if nation admin - roles will be empty)
  const orgs = useMemo(() => {
    if (!accessibleOrgsData?.orgs) return { orgs: [] };
    const adminOrgs = accessibleOrgsData.orgs.filter(
      (org) =>
        // Nation admins get empty roles array but can manage all orgs
        org.roles.length === 0 ||
        org.roles.includes("admin") ||
        org.roles.includes("editor"),
    );
    return { orgs: adminOrgs };
  }, [accessibleOrgsData]);

  const isAdmin = useMemo(() => {
    return session?.roles?.some((r) => r.roleName === "admin") ?? false;
  }, [session?.roles]);

  const canEditUser = useMemo(() => {
    if (!user?.id) return true;
    if (session?.id === user.id) return true;
    if (user.homeRegionId == null) return isAdmin;

    const accessibleOrgIds = new Set((orgs?.orgs ?? []).map((org) => org.id));
    return accessibleOrgIds.has(user.homeRegionId);
  }, [user?.id, user?.homeRegionId, orgs?.orgs, session?.id, isAdmin]);

  const isHomeRegionDisabled = useMemo(() => {
    if (session?.id === user?.id) return false;
    if (user?.homeRegionId == null) return !isAdmin;

    const accessibleOrgIds = new Set((orgs?.orgs ?? []).map((org) => org.id));
    return !accessibleOrgIds.has(user.homeRegionId);
  }, [session?.id, user?.id, user?.homeRegionId, orgs?.orgs, isAdmin]);

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
      homeRegionId: user?.homeRegionId ?? null,
      status: user?.status ?? "active",
    },
  });

  useEffect(() => {
    if (!user) return;

    form.reset({
      id: user.id ?? undefined,
      f3Name: user?.f3Name ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
      roles: user?.roles,
      homeRegionId: user?.homeRegionId ?? null,
      status: user?.status ?? "active",
      phone: user?.phone ?? "",
    });
  }, [form, user]);

  const crupdateUser = useMutation(
    orpc.user.crupdate.mutationOptions({
      onSuccess: async (data) => {
        await invalidateQueries("user");
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
            {!canEditUser ? "View" : user?.id ? "Edit" : "Add"} User
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
                  };
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
                          disabled={!canEditUser}
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
                          disabled={!canEditUser}
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
                          disabled={!canEditUser}
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
                              disabled={!canEditUser}
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
                              disabled={!canEditUser}
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
                        disabled={!canEditUser}
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

              <div className="mb-4 w-1/2 px-2">
                <FormField
                  control={form.control}
                  name="homeRegionId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Home Region</FormLabel>
                      <FormControl>
                        {isHomeRegionDisabled ? (
                          <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                            {user?.homeRegion?.homeRegionName}
                          </div>
                        ) : (
                          <VirtualizedCombobox
                            value={
                              field.value === null || field.value === undefined
                                ? undefined
                                : String(field.value)
                            }
                            options={
                              regions?.orgs.map((region) => ({
                                value: region.id.toString(),
                                label: region.name,
                              })) ?? []
                            }
                            searchPlaceholder="Select a home region"
                            onSelect={(value) => {
                              if (Array.isArray(value)) {
                                field.onChange(null);
                                return;
                              }

                              const parsedValue = safeParseInt(value);
                              if (parsedValue === undefined) {
                                toast.error("Invalid home region");
                                return;
                              }

                              field.onChange(parsedValue);
                            }}
                            isMulti={false}
                          />
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="mb-4 w-full px-2">
                {!canEditUser && (
                  <p className="pb-2 text-center text-sm text-muted-foreground">
                    You do not have permission to edit this user. You can only
                    modify users whose home region you manage.
                  </p>
                )}
                <div className="flex space-x-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => closeModal()}
                    className="w-full"
                  >
                    {canEditUser ? "Cancel" : "Close"}
                  </Button>
                  {canEditUser && (
                    <Button type="submit" className="w-full">
                      Save Changes
                    </Button>
                  )}
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
                          openModal(ModalType.ADMIN_MANAGE_ACCESS, {
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
