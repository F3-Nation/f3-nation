import type { Session } from "@acme/auth";
import { vi } from "vitest";

// Mock next/server before anything imports it
vi.mock("next/server", () => ({
  default: {},
}));

// Mock next-auth to avoid Next.js dependencies
vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

// Mock @acme/auth to avoid Next.js dependencies
// Return a default session with admin role for tests (admin can do everything)
const defaultSession: Session = {
  id: 1,
  email: "test@example.com",
  user: {
    id: "1",
    email: "test@example.com",
    name: "Test User",
    roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
  },
  roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
  expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
};

vi.mock("@acme/auth", () => ({
  auth: vi.fn().mockResolvedValue(defaultSession),
}));
