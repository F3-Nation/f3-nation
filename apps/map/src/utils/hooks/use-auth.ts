import { F3_NATION_ORG_ID } from "@acme/shared/app/constants";
import { useSession } from "next-auth/react";
import { useMemo } from "react";

export const useAuth = () => {
  const { data: session, status } = useSession();
  const { isNationAdmin, isEditorOrAdmin, isAdmin } = useMemo(() => {
    if (!session)
      return { isNationAdmin: false, isEditorOrAdmin: false, isAdmin: false };
    let isNationAdmin = false;
    let isEditorOrAdmin = false;
    let isAdmin = false;
    session.roles?.forEach((role) => {
      // Must be admin on orgId 1 (the F3 Nation org) - checking both ID and name for security
      if (
        role.roleName === "admin" &&
        role.orgId === F3_NATION_ORG_ID &&
        role.orgName.toLowerCase().includes("f3 nation")
      ) {
        isNationAdmin = true;
      }
      if (["admin", "editor"].includes(role.roleName)) {
        isEditorOrAdmin = true;
      }
      if (["admin"].includes(role.roleName)) {
        isAdmin = true;
      }
    });
    return { isNationAdmin, isEditorOrAdmin, isAdmin };
  }, [session]);

  return { session, isNationAdmin, isEditorOrAdmin, isAdmin, status };
};
