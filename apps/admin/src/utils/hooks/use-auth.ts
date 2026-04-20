import { useMemo } from "react";
import { useSession } from "next-auth/react";

import { isNationAdminFromSession } from "@acme/shared/app/role-checks";

export const useAuth = () => {
  const { data: session, status } = useSession();
  const { isNationAdmin, isEditorOrAdmin, isAdmin } = useMemo(() => {
    if (!session)
      return { isNationAdmin: false, isEditorOrAdmin: false, isAdmin: false };
    let isEditorOrAdmin = false;
    let isAdmin = false;
    session.roles?.forEach((role) => {
      if (["admin", "editor"].includes(role.roleName)) {
        isEditorOrAdmin = true;
      }
      if (["admin"].includes(role.roleName)) {
        isAdmin = true;
      }
    });
    return {
      isNationAdmin: isNationAdminFromSession(session),
      isEditorOrAdmin,
      isAdmin,
    };
  }, [session]);

  return { session, isNationAdmin, isEditorOrAdmin, isAdmin, status };
};
