"use client";

import { useEffect } from "react";
import { z } from "zod";

import { Z_INDEX } from "@acme/shared/app/constants";
import { Badge } from "@acme/ui/badge";
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

const BASE_SCOPES = ["openid", "profile", "email"];

const OauthClientFormSchema = z.object({
  name: z.string().trim().min(1, { error: "Name is required" }),
  redirectUris: z
    .string()
    .trim()
    .min(1, { error: "At least one redirect URI is required" }),
  offlineAccess: z.boolean(),
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

/**
 * Edit-only — there's no create flow here. Registering a brand-new client
 * needs a client_secret hashed the way Better Auth's own oauthProvider
 * plugin verifies it, which stays on apps/auth's CLI script until that's
 * resolved (see packages/api/src/router/oauth-client.ts's file comment).
 */
export default function AdminOauthClientsModal({
  data,
}: {
  data: DataType[ModalType.ADMIN_OAUTH_CLIENTS];
}) {
  const clientId = data.clientId;

  const {
    data: clientsData,
    isLoading: isClientsLoading,
    isError: isClientsError,
  } = useQuery(orpc.oauthClient.list.queryOptions());
  const existing = clientsData?.clients.find((c) => c.clientId === clientId);
  // Gated on !existing rather than isClientsError directly: a background
  // refetch error still leaves clientsData holding the last successful
  // fetch's cached clients, and existing should still resolve from that
  // cached list rather than being treated as unavailable.
  const isTargetUnavailable = !isClientsLoading && !existing;

  const form = useForm({
    schema: OauthClientFormSchema,
    defaultValues: {
      name: "",
      redirectUris: "",
      offlineAccess: true,
    },
  });

  useEffect(() => {
    if (existing) {
      form.reset({
        name: existing.name ?? "",
        redirectUris: existing.redirectUris.join("\n"),
        offlineAccess: (existing.scopes ?? []).includes("offline_access"),
      });
    }
  }, [existing, form]);

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

  return (
    <Dialog open onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className="max-w-[600px]"
      >
        <DialogHeader>
          <DialogTitle>Edit OAuth Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isClientsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-5 w-5" />
            </div>
          ) : isTargetUnavailable ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <p>
                {isClientsError
                  ? "Unable to load this client. Please try again."
                  : "This client could not be found."}
              </p>
              <Button variant="outline" onClick={() => closeModal()}>
                Close
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono">{clientId}</span>
                <Badge variant={existing?.isPublic ? "outline" : "secondary"}>
                  {existing?.isPublic ? "Public (PKCE)" : "Confidential"}
                </Badge>
              </div>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit(
                  async (values) => {
                    // Preserve any scopes beyond the ones this form exposes
                    // (e.g. granted directly via apps/auth's CLI script)
                    // instead of clobbering them on every edit.
                    const customScopes = (existing?.scopes ?? []).filter(
                      (scope) =>
                        !BASE_SCOPES.includes(scope) &&
                        scope !== "offline_access",
                    );
                    const scopes = values.offlineAccess
                      ? [...BASE_SCOPES, ...customScopes, "offline_access"]
                      : [...BASE_SCOPES, ...customScopes];
                    await updateClient.mutateAsync({
                      clientId,
                      name: values.name,
                      redirectUris: parseRedirectUris(values.redirectUris),
                      scopes,
                    });
                  },
                  () => {
                    toast.error("Failed to update OAuth client");
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
                    disabled={updateClient.isPending}
                  >
                    Close
                  </Button>
                  <Button type="submit" disabled={updateClient.isPending}>
                    {updateClient.isPending ? (
                      <span className="flex items-center gap-2">
                        Saving <Spinner className="h-4 w-4" />
                      </span>
                    ) : (
                      "Save changes"
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
