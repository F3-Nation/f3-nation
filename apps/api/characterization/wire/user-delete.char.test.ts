import { describe, expect, it } from "vitest";

import { db } from "@acme/api/testing";
import { and, eq, schema, sql } from "@acme/db";

import { createApiKey } from "../fixtures/api-keys";
import { createFixtureUser } from "../fixtures/users";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

describe.runIf(target.inProcess)("user deletion response contract", () => {
  it.each(["REST", "RPC"] as const)(
    "returns the deleted user ID over %s after removing the user and roles",
    async (transport) => {
      const teardowns: (() => Promise<void>)[] = [];
      try {
        let [nation] = await db
          .select({ id: schema.orgs.id })
          .from(schema.orgs)
          .where(
            and(
              eq(schema.orgs.name, "F3 Nation"),
              eq(schema.orgs.orgType, "nation"),
            ),
          )
          .limit(1);
        if (!nation) {
          [nation] = await db
            .insert(schema.orgs)
            .values({ name: "F3 Nation", orgType: "nation", isActive: true })
            .returning({ id: schema.orgs.id });
          if (!nation) throw new Error("Failed to insert fixture nation");
          const nationId = nation.id;
          teardowns.push(async () => {
            await db.delete(schema.orgs).where(eq(schema.orgs.id, nationId));
          });
        }

        const key = await createApiKey({
          roles: [{ orgId: nation.id, roleName: "admin" }],
        });
        teardowns.push(key.cleanup);
        const user = await createFixtureUser({
          roles: [
            { orgId: nation.id, roleName: "editor" },
            { orgId: nation.id, roleName: "admin" },
          ],
        });
        teardowns.push(user.cleanup);
        const headers = {
          authorization: `Bearer ${key.key}`,
          client: transport === "REST" ? "characterization" : "orpc",
          "x-forwarded-for": transport === "REST" ? "10.100.0.1" : "10.100.0.2",
        };
        let decoded: unknown;
        const response =
          transport === "REST"
            ? await target.invoke(
                req(`/v1/user/delete/${user.userId}`, {
                  method: "DELETE",
                  headers,
                }),
              )
            : await rpcResponse(async (client) => {
                decoded = await client.user.delete({ id: user.userId });
                return decoded;
              }, headers);

        expect(response.status).toBe(200);
        expect(transport === "REST" ? await response.json() : decoded).toEqual({
          userId: user.userId,
        });
        expect(
          await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.id, user.userId)),
        ).toEqual([]);
        expect(
          await db
            .select({ userId: schema.rolesXUsersXOrg.userId })
            .from(schema.rolesXUsersXOrg)
            .where(eq(schema.rolesXUsersXOrg.userId, user.userId)),
        ).toEqual([]);
        expect(
          await db.execute(sql`
            SELECT changed_by, changed_via FROM public_history.users
            WHERE row_id = ${String(user.userId)} AND op = 'D'
          `),
        ).toEqual([{ changed_by: null, changed_via: null }]);
        expect(
          await db.execute(sql`
            SELECT changed_by, changed_via FROM public_history.roles_x_users_x_org
            WHERE old_row->>'user_id' = ${String(user.userId)} AND op = 'D'
          `),
        ).toEqual([
          { changed_by: null, changed_via: null },
          { changed_by: null, changed_via: null },
        ]);
      } finally {
        const results: PromiseSettledResult<unknown>[] = [];
        for (const teardown of teardowns.reverse()) {
          results.push(...(await Promise.allSettled([teardown()])));
        }
        expect(
          results.filter((result) => result.status === "rejected"),
        ).toEqual([]);
      }
    },
  );
});
