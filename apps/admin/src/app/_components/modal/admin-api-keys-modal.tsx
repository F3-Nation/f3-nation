"use client";

import uniqBy from "lodash/uniqBy";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
import type { RoleEntry } from "@acme/shared/app/types";
import { safeParseInt } from "@acme/shared/common/functions";
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
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";
import { client } from "~/orpc/client";
import { invalidateQueries, orpc, ORPCError, useMutation } from "~/orpc/react";
import { useAuth } from "~/utils/hooks/use-auth";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";
import { closeModal } from "~/utils/store/modal";

const ApiKeyFormSchema = z.object({
  name: z.string().trim().min(1, { error: "Name is required" }),
  description: z.string().optional(),
  roles: z
    .object({
      orgId: z.number(),
      roleName: z.enum(["editor", "admin"]),
    })
    .array(),
  expiresAt: z.string().optional(),
});

export default function AdminApiKeysModal() {
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const { isNationAdmin } = useAuth();
  const { data: accessibleOrgs, isLoading: isLoadingOrgs } = useFetchAllPages({
    path: ["org", "accessible"],
    queryKey: ["org.accessible.adminApiKeysModal"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.accessible({
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
  });
  const form = useForm({
    schema: ApiKeyFormSchema,
    defaultValues: {
      name: "",
      description: "",
      roles: [] as RoleEntry[],
      expiresAt: "",
    },
  });

  // apiKey.create only accepts orgs the caller administers directly or through
  // an ancestor. org.accessible also returns orgs under editor-only roots, and
  // descendant rows carry no roles, so walk up to a direct admin role.
  const adminOrgs = useMemo(() => {
    if (!accessibleOrgs) return [];
    if (isNationAdmin) return accessibleOrgs;
    const byId = new Map(accessibleOrgs.map((org) => [org.id, org]));
    const isAdministered = (orgId: number | null): boolean => {
      for (let id = orgId; id != null;) {
        const org = byId.get(id);
        if (!org) return false;
        if (org.roles.includes("admin")) return true;
        id = org.parentId;
      }
      return false;
    };
    return accessibleOrgs.filter((org) => isAdministered(org.id));
  }, [accessibleOrgs, isNationAdmin]);

  const orgOptions = useMemo(() => {
    return adminOrgs.map((org) => ({
      value: org.id.toString(),
      label: `${org.name} (${org.orgType})`,
    }));
  }, [adminOrgs]);

  const nextUnusedOrgId = (roles: RoleEntry[] | undefined) => {
    const usedOrgIds = new Set((roles ?? []).map((r) => r.orgId));
    return adminOrgs.find((org) => !usedOrgIds.has(org.id))?.id;
  };

  const createApiKey = useMutation(
    orpc.apiKey.create.mutationOptions({
      onSuccess: async (result) => {
        setCreatedSecret(result.secret);
        toast.success("API key created");
        form.reset({
          name: "",
          description: "",
          roles: [],
          expiresAt: "",
        });

        // Force refetch of the API keys list
        await invalidateQueries("apiKey");
      },
      onError: (err) => {
        // FORBIDDEN names the org-role pair the caller can't grant
        toast.error(
          err instanceof ORPCError && err.code === "FORBIDDEN"
            ? err.message
            : "Unable to create API key",
        );
      },
    }),
  );

  const handleCopySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast.success("Secret copied");
    } catch (error) {
      console.log("copy secret", { error });
      toast.error("Unable to copy secret");
    }
  };

  return (
    <Dialog open onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className="max-w-[600px]"
      >
        <DialogHeader>
          <DialogTitle>
            {createdSecret ? "API Key Created" : "Create API Key"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {createdSecret ? (
            <>
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  Copy this secret now. You will not be able to view it again.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <code className="rounded-sm bg-background px-2 py-1 text-sm break-all">
                    {createdSecret}
                  </code>
                  <Button
                    onClick={handleCopySecret}
                    variant="secondary"
                    className="shrink-0"
                  >
                    Copy secret
                  </Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => closeModal()}>Done</Button>
              </div>
            </>
          ) : (
            <Form {...form}>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit(
                  async (values) => {
                    const expiresAt = values.expiresAt
                      ? new Date(values.expiresAt).toISOString()
                      : undefined;
                    await createApiKey.mutateAsync({
                      name: values.name,
                      description: values.description ?? undefined,
                      // Two rows can land on the same org via the picker;
                      // a duplicate pair fails the roles insert.
                      roles: uniqBy(
                        values.roles ?? [],
                        (r) => `${r.orgId}:${r.roleName}`,
                      ),
                      expiresAt,
                    });
                  },
                  (errors) => {
                    toast.error("Failed to create API key");
                    console.log("errors", errors);
                  },
                )}
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Integration name" {...field} />
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
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="What does this key do?"
                          {...field}
                        />
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
                      <FormDescription>
                        Assign roles to orgs for this API key.
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
                                options={orgOptions}
                                searchPlaceholder="Select an org"
                                disabled={isLoadingOrgs}
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
                            // Disabled until the orgs load, and once every
                            // administered org already has a row, so a new row
                            // never starts on an org the user can't grant or on
                            // a duplicate.
                            disabled={!nextUnusedOrgId(field.value)}
                            onClick={() => {
                              const orgId = nextUnusedOrgId(field.value);
                              if (!orgId) return;
                              const newRoleEntry: RoleEntry = {
                                roleName: "editor",
                                orgId,
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
                <FormField
                  control={form.control}
                  name="expiresAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expiration</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Optional. Key will stop working after this date.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => closeModal()}
                    disabled={createApiKey.isPending}
                  >
                    Close
                  </Button>
                  <Button type="submit" disabled={createApiKey.isPending}>
                    {createApiKey.isPending ? (
                      <span className="flex items-center gap-2">
                        Creating <Spinner className="h-4 w-4" />
                      </span>
                    ) : (
                      "Create key"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
