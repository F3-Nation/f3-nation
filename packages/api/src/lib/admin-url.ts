import { env } from "@acme/env";

import { logError, logWarn } from "../logger";

const ADMIN_URL_BY_CHANNEL: Partial<
  Record<typeof env.NEXT_PUBLIC_CHANNEL, string>
> = {
  prod: "https://admin.f3nation.com",
  staging: "https://staging.admin.f3nation.com",
};

/**
 * Absolute URL of the admin app's requests page, for links in emails.
 *
 * Prefers `NEXT_PUBLIC_ADMIN_URL`, then falls back to the known admin host for
 * the deployment channel. A relative link is useless in an email, so when no
 * absolute URL can be built this logs an error and returns the bare path.
 */
export const getAdminRequestsUrl = (): string => {
  const channel = env.NEXT_PUBLIC_CHANNEL;
  const configured = env.NEXT_PUBLIC_ADMIN_URL?.trim().replace(/\/+$/, "");

  // URL.canParse alone accepts things like "localhost:3002" (scheme "localhost:")
  const isAbsolute =
    !!configured &&
    /^https?:\/\//i.test(configured) &&
    URL.canParse(configured);
  if (configured && !isAbsolute) {
    logWarn("api.admin_url.invalid_configured", { channel });
  }

  const baseUrl = isAbsolute ? configured : ADMIN_URL_BY_CHANNEL[channel];
  if (!baseUrl) {
    logError("api.admin_url.unresolved", { channel });
  }

  return `${baseUrl ?? ""}/requests`;
};
