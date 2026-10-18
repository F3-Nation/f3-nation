import { useMemo } from "react";

import { isNationAdminFromSession } from "@acme/shared/app/role-checks";

import { useAdminSession } from "~/lib/auth/client";

export const useAuth = () => {
  const { data: session, status } = useAdminSession();
  const { isNationAdmin, isEditorOrAdmin, isAdmin } = useMemo(() => {
    if (!session)
      return { isNationAdmin: false, isEditorOrAdmin: false, isAdmin: false };
    let isEditorOrAdmin = false;
    let isAdmin = false;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- /api/auth/me JSON is cast, not parsed, and may omit roles
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
