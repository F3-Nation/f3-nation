import { ORPCError } from "@orpc/server";
import { SafeUrlSchema } from "@better-auth/core/utils/redirect-uri";
import { z } from "zod";

import { authSchema, desc, eq, sql } from "@acme/db";

import { nationAdminProcedure } from "../shared";

/**
 * Admin UI for apps/auth's Better Auth OAuth client registrations (#876 Phase
 * 3, #949) — list every registered client, edit it, enable/disable it, from
 * apps/admin instead of the CLI-only apps/auth/scripts/add-client.ts.
 *
 * Unlike an earlier version of this router, there is no service-to-service
 * call to apps/auth here: apps/api and apps/auth share one Postgres database,
 * and the Better Auth client table lives in that database under the `auth`
 * schema. `ctx.db` (from nationAdminProcedure) is the same connection
 * apps/auth's Better Auth instance itself reads and writes through, so a
 * plain Drizzle query is enough — no shared secret, no new env var, no
 * bearer-token hop. nationAdminProcedure (not adminProcedure) gates every
 * handler: adminProcedure only checks for an "admin" role name with no org
 * scoping, so any org's admin would qualify for what's meant to be
 * nation-wide SSO client administration — the same distinction
 * packages/api/src/router/mail.ts already makes for its own nation-wide
 * operations.
 *
 * Create is deliberately NOT implemented here. `betterAuthOauthClient
 * .clientSecret` has to be in whatever format Better Auth's own
 * `oauthProvider` plugin hashes and verifies internally — a raw insert from
 * this router risks producing a secret that plugin can't verify at token
 * exchange, silently minting an unusable client. That's the same open
 * question apps/auth/scripts/migrate-oauth-clients-to-better-auth.ts already
 * flags for Phase 4. Client creation stays on apps/auth's own tooling until
 * that's resolved.
 *
 * Can't be exercised end-to-end yet: apps/auth's Better Auth instance
 * (AUTH_USE_BETTER_AUTH) isn't deployed anywhere live, and the
 * better_auth_* migration it depends on hasn't been applied — see
 * packages/db/drizzle/schema.ts's "DRAFTED, NOT APPLIED" comment. This
 * router is shaped and ready for when it is.
 */

const oauthClientSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  redirectUris: z.array(z.string()),
  scopes: z.array(z.string()).nullable(),
  // Derived, not stored directly — Better Auth records this as the OAuth
  // token_endpoint_auth_method instead of a plain public/confidential flag.
  // "none" means PKCE-only with no client secret ever verified; anything
  // else means the client is expected to authenticate with a secret.
  isPublic: z.boolean(),
  disabled: z.boolean().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

function toOauthClient(
  row: typeof authSchema.betterAuthOauthClient.$inferSelect,
): z.infer<typeof oauthClientSchema> {
  return {
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
    scopes: row.scopes,
    isPublic: row.tokenEndpointAuthMethod === "none",
    disabled: row.disabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const oauthClientRouter = {
  list: nationAdminProcedure
    .route({
      method: "GET",
      path: "/",
      tags: ["oauth-client"],
      summary: "List OAuth clients",
      description:
        "List every OAuth client registered against the Better Auth instance. Never returns client secrets. Requires F3 Nation admin role.",
    })
    .output(z.object({ clients: z.array(oauthClientSchema) }))
    .handler(async ({ context: ctx }) => {
      const rows = await ctx.db
        .select()
        .from(authSchema.betterAuthOauthClient)
        .orderBy(desc(authSchema.betterAuthOauthClient.createdAt));

      return { clients: rows.map(toOauthClient) };
    }),

  update: nationAdminProcedure
    .input(
      z.object({
        clientId: z.string(),
        name: z.string().min(1).optional(),
        redirectUris: z.array(SafeUrlSchema).min(1).optional(),
        scopes: z.array(z.string()).optional(),
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
        "Update an OAuth client's name, redirect URIs, scopes, or enabled state. At least one of those fields must be provided in addition to clientId. Never returns the client secret. Requires F3 Nation admin role.",
    })
    .output(z.object({ client: oauthClientSchema }))
    .handler(async ({ context: ctx, input }) => {
      const { clientId, ...update } = input;

      if (Object.keys(update).length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "At least one field must be provided",
        });
      }

      const [row] = await ctx.db
        .update(authSchema.betterAuthOauthClient)
        .set({ ...update, updatedAt: sql`timezone('utc'::text, now())` })
        .where(eq(authSchema.betterAuthOauthClient.clientId, clientId))
        .returning();

      if (!row) {
        throw new ORPCError("NOT_FOUND");
      }

      return { client: toOauthClient(row) };
    }),
};
