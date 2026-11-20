import { useMemo } from "react";

import {
  AdminScopeOrgTypes,
  getOrgById,
  isDescendantOfAny,
} from "~/app/_components/org/org-ancestry";
import { client } from "~/orpc/client";
import { useAuth } from "~/utils/hooks/use-auth";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

/**
 * The orgs the signed-in user may give or remove roles on: those where they
 * are an admin, directly or through an org above. The API requires exactly
 * that to change roles, so role editors offer only these. Each org's `roles`
 * from `org.accessible` lists direct roles only (descendants of a root, and
 * every org for someone with any F3 Nation role, carry none), so it can't
 * decide this alone; the session's admin roles and the org's ancestors do.
 * `isError` is set when the list failed to load, so an editor can say so
 * instead of looking as if the user manages no orgs.
 */
export function useRoleGrantOrgs() {
  const { session } = useAuth();
  const { data, isLoading, isError } = useFetchAllPages({
    path: ["org", "accessible"],
    queryKey: ["org.accessible.roleGrantOrgs"],
    fetchPage: async ({ pageIndex, pageSize }) => {
      const { orgs, total } = await client.org.accessible({
        orgTypes: AdminScopeOrgTypes,
        pageIndex,
        pageSize,
      });
      return { items: orgs, total };
    },
  });
  const orgs = useMemo(() => {
    const all = data ?? [];
    const adminOrgIds = new Set(
      (session?.roles ?? [])
        .filter((role) => role.roleName === "admin")
        .map((role) => role.orgId),
    );
    const orgById = getOrgById(all);
    return all.filter(
      (org) =>
        adminOrgIds.has(org.id) || isDescendantOfAny(org, adminOrgIds, orgById),
    );
  }, [data, session]);
  return { orgs, isLoading, isError };
}
