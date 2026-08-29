import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { env } from "@acme/env";

import { logError } from "../logger";
import { nationAdminProcedure } from "../shared";

/**
 * Admin UI for apps/auth's OAuth client registrations (#876 Phase 3) — the
 * "similar to what we were doing with Logto" ask: list every registered
 * client, create one, edit it, enable/disable it, from apps/admin instead
 * of the CLI-only apps/auth/scripts/add-client.ts.
 *
 * Unlike every other router in this package, the data doesn't live in this
 * app's own DB — it lives in apps/auth's Better Auth instance, a separate
 * deployed app. So every handler here is a server-to-server fetch to
 * apps/auth/src/app/api/admin/oauth-clients/*, authenticated with
 * SUPER_ADMIN_API_KEY (the same shared secret packages/api/src/shared.ts's
 * revalidateAuthProcedure already uses for this exact pattern), never
 * exposed to the browser — the browser only ever talks to
 * nationAdminProcedure here, which enforces its own session-based
 * nation-admin check first. Plain adminProcedure isn't enough: it only
 * checks for an "admin" role name with no org scoping, so any org's admin
 * would qualify for what's meant to be nation-wide SSO client
 * administration — the same distinction packages/api/src/router/mail.ts
 * already makes for its own nation-wide operations.
 *
 * Can't be exercised end-to-end yet: apps/auth's Better Auth instance
 * (AUTH_USE_BETTER_AUTH) isn't deployed anywhere live, and the
 * better_auth_* migration it depends on hasn't been applied — see
 * packages/db/drizzle/schema.ts's "DRAFTED, NOT APPLIED" comment. This
 * router is shaped and ready for when it is.
 */

function authBaseUrl(): string {
  if (!env.NEXT_PUBLIC_AUTH_URL) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "NEXT_PUBLIC_AUTH_URL is not configured",
    });
  }
  return env.NEXT_PUBLIC_AUTH_URL;
}

// Bounds how long an admin request can hang on the auth server before
// failing — without it a hung server blocks the request thread indefinitely.
const AUTH_SERVER_TIMEOUT_MS = 10_000;

function authAdminHeaders(): HeadersInit {
  if (!env.SUPER_ADMIN_API_KEY) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "SUPER_ADMIN_API_KEY is not configured",
    });
  }
  return {
    "Content-Type": "application/json",
    "x-api-key": env.SUPER_ADMIN_API_KEY,
  };
}

const oauthClientSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  redirectUris: z.array(z.string()),
  scopes: z.array(z.string()).nullable(),
  isPublic: z.boolean(),
  disabled: z.boolean().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const oauthClientRouter = {
  list: nationAdminProcedure
    .route({
      method: "GET",
      path: "/",
      tags: ["oauth-client"],
      summary: "List OAuth clients",
      description:
        "List every OAuth client registered against the auth server (apps/auth). Requires F3 Nation admin role.",
    })
    .output(z.object({ clients: z.array(oauthClientSchema) }))
    .handler(async () => {
      // Computed before the try block so a missing-env-var ORPCError from
      // either helper propagates with its own accurate message, instead of
      // being caught below and relabeled as "unable to reach the auth
      // server" when the auth server was never actually contacted.
      const url = `${authBaseUrl()}/api/admin/oauth-clients`;
      const headers = authAdminHeaders();
      let res: Response;
      try {
        res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(AUTH_SERVER_TIMEOUT_MS),
        });
      } catch (error) {
        logError("api.oauth_client.list_unreachable", {}, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Unable to reach the auth server",
        });
      }
      if (!res.ok) {
        logError("api.oauth_client.list_failed", { status: res.status });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to list OAuth clients",
        });
      }
      return (await res.json()) as {
        clients: z.infer<typeof oauthClientSchema>[];
      };
    }),

  create: nationAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        redirectUris: z.array(z.url()).min(1),
        scope: z
          .string()
          .default("openid profile email")
          .describe("Space-separated scopes"),
        isPublic: z
          .boolean()
          .describe(
            "Public (PKCE-only, no secret — native/mobile apps) vs confidential (client_secret_basic)",
          ),
      }),
    )
    .route({
      method: "POST",
      path: "/",
      tags: ["oauth-client"],
      summary: "Create an OAuth client",
      description:
        "Register a new OAuth client against the auth server. The response includes the client_secret exactly once, for confidential clients — it is never retrievable again after this call. Requires F3 Nation admin role.",
    })
    .output(z.object({ client: z.record(z.string(), z.unknown()) }))
    .handler(async ({ input }) => {
      const url = `${authBaseUrl()}/api/admin/oauth-clients`;
      const headers = authAdminHeaders();
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(AUTH_SERVER_TIMEOUT_MS),
        });
      } catch (error) {
        logError(
          "api.oauth_client.create_unreachable",
          { name: input.name },
          error,
        );
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Unable to reach the auth server",
        });
      }
      if (!res.ok) {
        logError("api.oauth_client.create_failed", {
          name: input.name,
          status: res.status,
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create OAuth client",
        });
      }
      return (await res.json()) as { client: Record<string, unknown> };
    }),

  update: nationAdminProcedure
    .input(
      z.object({
        clientId: z.string(),
        name: z.string().min(1).optional(),
        redirectUris: z.array(z.url()).min(1).optional(),
        scope: z.string().optional(),
        disabled: z
          .boolean()
          .optional()
          .describe(
            "Enable/disable — the only supported way to deactivate a client. There is no delete: docs/AI_GUARDRAILS.md requires a soft delete when one exists.",
          ),
      }),
    )
    .route({
      method: "PATCH",
      path: "/{clientId}",
      tags: ["oauth-client"],
      summary: "Update an OAuth client",
      description:
        "Update an OAuth client's name, redirect URIs, scope, or enabled state. Requires F3 Nation admin role.",
    })
    .output(z.object({ updated: z.boolean() }))
    .handler(async ({ input }) => {
      const { clientId, ...update } = input;
      const url = `${authBaseUrl()}/api/admin/oauth-clients/${encodeURIComponent(clientId)}`;
      const headers = authAdminHeaders();
      let res: Response;
      try {
        res = await fetch(url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(update),
          signal: AbortSignal.timeout(AUTH_SERVER_TIMEOUT_MS),
        });
      } catch (error) {
        logError("api.oauth_client.update_unreachable", { clientId }, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Unable to reach the auth server",
        });
      }
      if (res.status === 404) {
        throw new ORPCError("NOT_FOUND");
      }
      if (!res.ok) {
        logError("api.oauth_client.update_failed", {
          clientId,
          status: res.status,
        });
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to update OAuth client",
        });
      }
      return (await res.json()) as { updated: boolean };
    }),
};
