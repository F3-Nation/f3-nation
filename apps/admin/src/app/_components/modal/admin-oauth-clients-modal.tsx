"use client";

import { useEffect, useState } from "react";
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
import { Checkbox } from "@acme/ui/checkbox";
import { Input } from "@acme/ui/input";
import { Spinner } from "@acme/ui/spinner";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import { invalidateQueries, orpc, useMutation, useQuery } from "~/orpc/react";
import type { DataType, ModalType } from "~/utils/store/modal";
import { closeModal } from "~/utils/store/modal";

const OauthClientFormSchema = z.object({
  name: z.string().trim().min(1, { error: "Name is required" }),
  redirectUris: z
    .string()
    .trim()
    .min(1, { error: "At least one redirect URI is required" }),
  offlineAccess: z.boolean(),
  isPublic: z.boolean(),
});

// oauth-provider validates each entry as a URL — this app additionally
// requires a reverse-domain custom scheme with no authority for public
// clients (RFC 8252 §7.1), matching apps/auth/scripts/add-client.ts's
// isValidRedirectUri, so a native app's redirect URI still parses even
// though it isn't https.
function parseRedirectUris(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function AdminOauthClientsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_OAUTH_CLIENTS];
}) {
  const clientId = data?.clientId;
  const isEditing = !!clientId;
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const { data: clientsData } = useQuery(orpc.oauthClient.list.queryOptions());
  const existing = clientsData?.clients.find((c) => c.clientId === clientId);

  const form = useForm({
    schema: OauthClientFormSchema,
    defaultValues: {
      name: "",
      redirectUris: "",
      offlineAccess: true,
      isPublic: false,
    },
  });

  useEffect(() => {
    if (existing) {
      form.reset({
        name: existing.name ?? "",
        redirectUris: existing.redirectUris.join("\n"),
        offlineAccess: (existing.scopes ?? []).includes("offline_access"),
        isPublic: existing.isPublic,
      });
    }
  }, [existing, form]);

  const createClient = useMutation(
    orpc.oauthClient.create.mutationOptions({
      onSuccess: async (result) => {
        const secret = result.client.client_secret;
        if (typeof secret === "string") {
          setCreatedSecret(secret);
        } else {
          // Public clients have no secret — nothing to reveal, just close.
          toast.success("OAuth client created");
          closeModal();
        }
        await invalidateQueries("oauthClient");
      },
      onError: () => {
        toast.error("Unable to create OAuth client");
      },
    }),
  );

  const updateClient = useMutation(
    orpc.oauthClient.update.mutationOptions({
      onSuccess: async () => {
        toast.success("OAuth client updated");
        await invalidateQueries("oauthClient");
        closeModal();
      },
      onError: () => {
        toast.error("Unable to update OAuth client");
      },
    }),
  );

  const isPending = createClient.isPending || updateClient.isPending;

  const handleCopySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast.success("Secret copied");
    } catch {
      toast.error("Unable to copy secret");
    }
  };

  const scope = (values: { offlineAccess: boolean }) =>
    values.offlineAccess
      ? "openid profile email offline_access"
      : "openid profile email";

  return (
    <Dialog open onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className="max-w-[600px]"
      >
        <DialogHeader>
          <DialogTitle>
            {createdSecret
              ? "OAuth Client Created"
              : isEditing
                ? "Edit OAuth Client"
                : "Create OAuth Client"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {createdSecret ? (
            <>
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  Copy this client secret now. You will not be able to view it
                  again.
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
                    const redirectUris = parseRedirectUris(values.redirectUris);
                    if (isEditing && clientId) {
                      await updateClient.mutateAsync({
                        clientId,
                        name: values.name,
                        redirectUris,
                        scope: scope(values),
                      });
                    } else {
                      await createClient.mutateAsync({
                        name: values.name,
                        redirectUris,
                        scope: scope(values),
                        isPublic: values.isPublic,
                      });
                    }
                  },
                  () => {
                    toast.error(
                      `Failed to ${isEditing ? "update" : "create"} OAuth client`,
                    );
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
                        <Input placeholder="e.g. Digital Weinke" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="redirectUris"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Redirect URIs</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={
                            "https://example.com/callback\ncom.example.app:/oauth2redirect"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        One per line. Public clients may use a reverse-domain
                        custom scheme (RFC 8252) instead of https.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isPublic"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-y-0 space-x-3 rounded-md border p-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isEditing}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Public client (PKCE-only)</FormLabel>
                        <FormDescription>
                          For native/mobile apps that can't keep a secret
                          confidential. No client_secret is issued.
                          {isEditing && " Can't be changed after creation."}
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offlineAccess"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-y-0 space-x-3 rounded-md border p-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>offline_access scope</FormLabel>
                        <FormDescription>
                          Grants refresh tokens. openid, profile, and email are
                          always included.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => closeModal()}
                    disabled={isPending}
                  >
                    Close
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? (
                      <span className="flex items-center gap-2">
                        Saving <Spinner className="h-4 w-4" />
                      </span>
                    ) : isEditing ? (
                      "Save changes"
                    ) : (
                      "Create client"
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
