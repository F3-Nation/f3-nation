"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TRPCClientError } from "@trpc/client";
import { Plus, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { z } from "zod";

import type { RoleEntry } from "@acme/shared/app/types";
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
  FormDescription,
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

import type { DataType, ModalType } from "~/utils/store/modal";
import { api } from "~/trpc/react";
import { closeModal } from "~/utils/store/modal";
import { VirtualizedCombobox } from "../virtualized-combobox";

export default function UserModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_USERS];
}) {
  const { data: session, update } = useSession();
  const utils = api.useUtils();
  const { data: user } = api.user.byId.useQuery({ id: data.id ?? -1 });
  const { data: orgs } = api.org.all.useQuery({
    orgTypes: ["region", "area", "sector", "nation"], // not ao
  });
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

  const crupdateUser = api.user.crupdate.useMutation({
    onSuccess: async (data) => {
      await utils.user.invalidate();
      const { roles } = data;
      if (session?.id === data.id && data.roles?.length > 0) {
        await update({ ...session, roles });
      }
      closeModal();
      toast.success("Successfully updated user");
      router.refresh();
    },
    onError: (err) => {
      if (err instanceof TRPCClientError) {
        toast.error(err.message);
      } else {
        toast.error(
          err?.data?.code === "UNAUTHORIZED"
            ? "You must be logged in to update users"
            : "Failed to update user",
        );
      }
    },
  });

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
                crupdateUser.mutate(data);
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
                <FormField
                  control={form.control}
                  name="roles"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Roles</FormLabel>
                      <FormDescription>
                        Must sign out and back in to apply these new roles.
                      </FormDescription>
                      <div className="space-y-2">
                        {((field.value as RoleEntry[]) || []).map(
                          (roleEntry, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-2"
                            >
                              <Select
                                onValueChange={(value) => {
                                  const newRoles = [
                                    ...(field.value as RoleEntry[]),
                                  ];
                                  newRoles[index] = {
                                    orgId: roleEntry.orgId,
                                    roleName: value as "editor" | "admin",
                                  };
                                  field.onChange(newRoles);
                                }}
                                value={roleEntry.roleName}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select a role" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="editor">Editor</SelectItem>
                                  <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                              </Select>

                              <VirtualizedCombobox
                                value={roleEntry.orgId.toString()}
                                options={
                                  orgs?.orgs.map((region) => ({
                                    value: region.id.toString(),
                                    label: `${region.name} (${region.orgType})`,
                                  })) ?? []
                                }
                                searchPlaceholder="Select a region"
                                onSelect={(value) => {
                                  const orgId = safeParseInt(value as string);
                                  if (orgId == undefined) {
                                    toast.error("Invalid orgId");
                                    return;
                                  }
                                  const newRoles = [
                                    ...(field.value as RoleEntry[]),
                                  ];
                                  newRoles[index] = {
                                    roleName:
                                      newRoles[index]?.roleName ?? "editor",
                                    orgId,
                                  };
                                  field.onChange(newRoles);
                                }}
                                isMulti={false}
                              />

                              <Button
                                variant="ghost"
                                type="button"
                                size="sm"
                                onClick={() => {
                                  const newRoles = [
                                    ...(field.value as RoleEntry[]),
                                  ];
                                  newRoles.splice(index, 1);
                                  field.onChange(newRoles);
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ),
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-col">
                            <p className="text-xs text-gray-500">
                              Admins can invite & edit
                            </p>
                            <p className="text-xs text-gray-500">
                              Editors can edit
                            </p>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => {
                              const newRoleEntry: RoleEntry = {
                                roleName: "editor",
                                orgId: 1,
                              };
                              field.onChange([
                                ...((field.value as RoleEntry[]) ?? []),
                                newRoleEntry,
                              ]);
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Role
                          </Button>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {/* <div className="mb-4 w-1/2 px-2">
                <FormField
                  control={form.control}
                  name="emergencyContact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Contact</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Emergency Contact"
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
                  name="emergencyPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Phone</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Emergency Phone"
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
                  name="emergencyNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Notes</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Emergency Notes"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div> */}

              {/* <div className="mb-4 w-1/2 px-2">
                {form.getValues("role") === UserRole[1] && (
                  <FormField
                    control={form.control}
                    name="homeRegionIds"
                    render={({ field }) => {
                      return (
                        <FormItem>
                          <FormLabel>Region</FormLabel>
                          <FormControl>
                            {regions ? (
                              <MultiSelect
                                defaultValue={(field.value ?? []).map(String)}
                                value={(field.value ?? []).map(String)}
                                options={regions.map((region) => ({
                                  label: region.name,
                                  value: region.id.toString(),
                                }))}
                                onValueChange={(values) =>
                                  field.onChange(values.map(Number))
                                }
                                placeholder="Select regions"
                              />
                            ) : (
                              <p>Loading regions...</p>
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                )}
              </div> */}

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
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
