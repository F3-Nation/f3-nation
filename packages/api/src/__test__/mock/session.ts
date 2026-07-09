import type { Session } from "@acme/auth";

/**
 * Creates a mock session for testing.
 */
export const createMockSession = (
  overrides: Partial<Session> = {},
): Session => ({
  id: 1,
  email: "test@example.com",
  expires: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
  user: {
    id: "1",
    email: "test@example.com",
    name: "Test User",
    roles: [{ orgId: 1, orgName: "Test Region", roleName: "editor" as const }],
  },
  roles: [{ orgId: 1, orgName: "Test Region", roleName: "editor" as const }],
  ...overrides,
});
