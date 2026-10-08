export const ERRORS = {
  MUST_BE_ADMIN_TO_GRANT_ROLES:
    "You must be an admin on this organization to grant roles to users",
  MUST_BE_ADMIN_TO_REMOVE_ROLES:
    "You must be an admin on this organization to remove roles from users",
  ROLE_CONFLICTS_WITH_HIDDEN_ROLE:
    "This user already holds a role on this organization that can't be changed here. Remove it first before assigning a new one.",
} as const;
