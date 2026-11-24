"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { routes } from "@acme/shared/app/constants";
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
import { toast } from "@acme/ui/toast";
import { CrupdateUserSchema } from "@acme/validators";

import type { RouterOutputs } from "~/orpc/types";
import { invalidateQueries, orpc, ORPCError, useMutation } from "~/orpc/react";
import { toRoleAssignments } from "~/lib/roles";
import { RoleAssignmentsField } from "~/app/_components/role-assignments-field";
import { useAuth } from "~/utils/hooks/use-auth";
import { useRoleGrantOrgs } from "~/utils/hooks/use-role-grant-orgs";
import { EmailChangeHint } from "~/app/_components/email-change-hint";

export default function UserMutate({
  user,
}: {
  user: RouterOutputs["user"]["byId"]["user"];
}) {
  const router = useRouter();
  const { isNationAdmin } = useAuth();
  // The API lets only nation admins change an existing user's email.
  const canChangeEmail = !user?.id || isNationAdmin;
  const {
    orgs: grantOrgs,
    isLoading: isLoadingOrgs,
    isError: orgsFailed,
  } = useRoleGrantOrgs();
  const [hasIncompleteRoles, setHasIncompleteRoles] = useState(false);
  // Names for the read-only rows of orgs this admin can't manage.
  const roleOrgNames = useMemo(
    () =>
      new Map(
        (user?.roles ?? []).flatMap((role) =>
          role.orgName ? [[role.orgId, role.orgName] as const] : [],
        ),
      ),
    [user],
  );

  const form = useForm({
    schema: CrupdateUserSchema,
    defaultValues: {
      id: user?.id,
      f3Name: user?.f3Name ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
      roles: toRoleAssignments(user?.roles),
    },
  });

  const crupdateUser = useMutation(
    orpc.user.crupdate.mutationOptions({
      onSuccess: async () => {
        await invalidateQueries("user");
        router.push(routes.admin.users.__path);
        toast.success("Successfully upserted user");
      },
      onError: (err) => {
        toast.error(
          err instanceof ORPCError
            ? err.code === "UNAUTHORIZED"
              ? "You are not authorized to upsert this user"
              : err.message || "Failed to upsert user"
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
                  if (hasIncompleteRoles) {
                    toast.error(
                      "Choose at least one role for each organization you added",
                    );
                    return;
                  }
                  if (data.roles.some((role) => role.orgId < 0)) {
                    toast.error(
                      "Please select an organization for all roles before saving",
                    );
                    return;
                  }
                  // Deliberately not logged: this payload is a full user record
                  // (email, phone, emergency contact). AGENTS.md: never log PII.
                  crupdateUser.mutate(data);
                },
                () => {
                  toast.error("Failed to upsert user");
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
                      <Input
                        placeholder="Email"
                        type="email"
                        disabled={!canChangeEmail}
                        {...field}
                      />
                    </FormControl>
                    {!canChangeEmail && <EmailChangeHint />}
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
                    <RoleAssignmentsField
                      value={field.value}
                      onChange={field.onChange}
                      orgOptions={grantOrgs}
                      orgNames={roleOrgNames}
                      isLoadingOrgs={isLoadingOrgs}
                      orgsFailed={orgsFailed}
                      onIncompleteChange={setHasIncompleteRoles}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex space-x-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(routes.admin.users.__path)}
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
