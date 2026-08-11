import type { Session } from "@acme/auth";
import { vi } from "vitest";

// Mock @acme/mail to prevent module-load-time crash when EMAIL_ADMIN_DESTINATIONS
// is unavailable in test workers (e.g. Vitest 3 forks pool in CI).
// API unit tests should never depend on real mail infrastructure.
vi.mock("@acme/mail", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    mail: {
      sendTemplateMessages: vi.fn().mockResolvedValue([]),
      getTemplate: vi.fn().mockReturnValue("<html></html>"),
      templates: {},
      adminDestinations: [],
    },
    DefaultTo: {},
  };
});

// Mock next-auth to avoid Next.js dependencies
vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

// Mock the Map app revalidation helper so mutation tests never make a real
// outbound HTTP request (and never log api.map_revalidate.* noise). The
// revalidation is fire-and-forget and not asserted by any test.
vi.mock("../lib/revalidate-map", () => ({
  triggerMapAppRevalidation: vi.fn().mockResolvedValue(undefined),
}));

// Mock the webhook HTTP client so tests never make real outbound fetch calls
// (and never log api.webhook.notify_failed noise in CI).
vi.mock("../lib/notify-webhooks", () => ({
  notifyWebhooks: vi.fn().mockResolvedValue(undefined),
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
