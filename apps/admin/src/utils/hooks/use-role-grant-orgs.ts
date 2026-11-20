import { useMemo } from "react";

import { AdminScopeOrgTypes } from "~/app/_components/org/org-ancestry";
import { client } from "~/orpc/client";
import { useFetchAllPages } from "~/utils/hooks/use-fetch-all-pages";

/**
 * The orgs the signed-in user may give or remove roles on: those where they
 * are an admin. The API requires admin on an org (or an org above it) to
 * change roles there, so role editors offer only these.
 */
export function useRoleGrantOrgs() {
  const { data, isLoading } = useFetchAllPages({
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
  const orgs = useMemo(
    () =>
      (data ?? []).filter(
        // A nation admin's orgs carry no roles but are all manageable.
        (org) => org.roles.length === 0 || org.roles.includes("admin"),
      ),
    [data],
  );
  return { orgs, isLoading };
}
