"use client";

import { useMemo, useState } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
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
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import { VirtualizedCombobox } from "~/app/_components/virtualized-combobox";
import { invalidateQueries, orpc, useMutation, useQuery } from "~/orpc/react";
import { closeModal } from "~/utils/store/modal";

const ApiKeyFormSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  orgIds: z
    .number()
    .array()
    .min(1, { message: "At least one org is required" }),
  expiresAt: z.string().optional(),
});

export default function AdminApiKeysModal() {
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const { data: orgQuery, isLoading: isLoadingOrgs } = useQuery(
    orpc.org.mine.queryOptions(),
  );

  const form = useForm({
    schema: ApiKeyFormSchema,
    defaultValues: {
      name: "",
      description: "",
      orgIds: [],
      expiresAt: "",
    },
  });

  const orgOptions = useMemo(() => {
    const orgs = orgQuery?.orgs ?? [];
    if (!orgs.length) {
      return [];
    }

    const formattedOptions = orgs.map((org) => ({
      value: org.id.toString(),
      label: `${org.name} (${org.orgType.toUpperCase()})`,
      orgId: org.id,
      parentId: org.parentId,
      roles: org.roles,
    }));

    // Only show orgs where the user has direct admin access
    // (not inherited from parent orgs)
    return formattedOptions.map(({ value, label, roles }) => {
      const isAdmin = roles.includes("admin");
      return {
        value,
        label: !isAdmin ? `${label} (No direct admin access)` : label,
        disabled: !isAdmin,
      };
    });
  }, [orgQuery?.orgs]);

  const createApiKey = useMutation(
    orpc.apiKey.create.mutationOptions({
      onSuccess: async (result) => {
        setCreatedSecret(result.secret);
        toast.success("API key created");
        form.reset({
          name: "",
          description: "",
          orgIds: [],
          expiresAt: "",
        });

        // Force refetch of the API keys list
        // Query key structure: [["apiKey", "list"], {"type": "query"}]
        await invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey;
            return (
              Array.isArray(key) &&
              key.length > 0 &&
              Array.isArray(key[0]) &&
              key[0].length >= 2 &&
              key[0][0] === "apiKey" &&
              key[0][1] === "list"
            );
          },
        });
      },
      onError: () => {
        toast.error("Unable to create API key");
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
                  <code className="break-all rounded bg-background px-2 py-1 text-sm">
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
                    if (!values.orgIds?.length) {
                      toast.error("Please select at least one org");
                      return;
                    }
                    const expiresAt = values.expiresAt
                      ? new Date(values.expiresAt).toISOString()
                      : undefined;
                    await createApiKey.mutateAsync({
                      name: values.name,
                      description: values.description ?? undefined,
                      orgIds: values.orgIds,
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
                  name="orgIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Org access</FormLabel>
                      <FormControl>
                        <VirtualizedCombobox
                          disabled={isLoadingOrgs}
                          value={field.value?.map((value) => value.toString())}
                          options={orgOptions}
                          isMulti
                          searchPlaceholder="Select orgs"
                          onSelect={(items) => {
                            const list = Array.isArray(items) ? items : [items];
                            const ids = list
                              .filter(Boolean)
                              .map((value) => Number(value));
                            field.onChange(ids);
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Select orgs where you have admin access. Only orgs you
                        are a direct admin of can be selected.
                      </FormDescription>
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
