"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import type { RoleEntry } from "@acme/shared/app/types";
import { safeParseInt } from "@acme/shared/common/functions";
import { Button } from "@acme/ui/button";
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

import type { RouterOutputs } from "~/orpc/types";
import { VirtualizedCombobox } from "~/app/_components/virtualized-combobox";
import {
  invalidateQueries,
  orpc,
  ORPCError,
  useMutation,
  useQuery,
} from "~/orpc/react";

export default function UserMutate({
  user,
}: {
  user: RouterOutputs["user"]["byId"]["user"];
}) {
  const router = useRouter();
  const { data: regions } = useQuery(
    orpc.org.all.queryOptions({ input: { orgTypes: ["region"] } }),
  );
  const sortedRegions = useMemo(() => {
    return regions?.orgs.sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  }, [regions]);

  const form = useForm({
    schema: CrupdateUserSchema,
    defaultValues: {
      id: user?.id,
      f3Name: user?.f3Name ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
      roles: user?.roles ?? [],
    },
  });

  const crupdateUser = useMutation(
    orpc.user.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries({
          predicate: (query) => query.queryKey[0] === "user",
        });
        router.push("/admin/users");
        toast.success("Successfully upserted user");
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError && err?.code === "UNAUTHORIZED"
            ? "You must be logged in to upsert users"
            : "Failed to upsert user",
        );
      },
    }),
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col space-y-6">
          <div className="flex flex-col items-center space-y-2 text-center">
            <h2 className="text-2xl font-semibold text-gray-900">
              {user ? "Edit User" : "Create User"}
            </h2>
            <p className="text-sm text-gray-500">
              {user
                ? "Edit user information below"
                : "Create user information below"}
            </p>
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(
                (data) => {
                  console.log(data);
                  crupdateUser.mutate(data);
                },
                (error) => {
                  toast.error("Failed to upsert user");
                  console.log(error);
                },
              )}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="id"
                render={({ field }) =>
                  user ? (
                    <FormItem>
                      <FormLabel>ID</FormLabel>
                      <FormControl>
                        <Input placeholder="ID" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  ) : (
                    <></>
                  )
                }
              />
              <FormField
                control={form.control}
                name="f3Name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
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

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Email" type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="roles"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
                    <div className="space-y-2">
                      {((field.value as RoleEntry[]) || []).map(
                        (roleEntry, index) => (
                          <div key={index} className="flex items-center gap-2">
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
                              options={sortedRegions.map((region) => ({
                                value: region.id.toString(),
                                label: region.name,
                              }))}
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

              <div className="flex space-x-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/admin/users")}
                  className="w-full"
                >
                  Cancel
                </Button>
                <Button type="submit" className="w-full">
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
