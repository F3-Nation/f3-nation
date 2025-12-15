import type { NodemailerConfig } from "next-auth/providers/nodemailer";

import { env } from "@acme/env";

export interface SendVerificationRequestServerParams {
  apiKey: string;
  identifier: string;
  url: string;
  server: string;
  from: string;
  token: string;
}

/**
 * Get the internal URL for server-to-server calls.
 * In local dev with custom domains (e.g., map.f3nation.test via Caddy),
 * Node.js won't trust the self-signed certificate. Use localhost instead.
 */
function getInternalApiUrl(params: { url: string }): string {
  const parsedUrl = new URL(params.url);
  const search = parsedUrl.search;

  // Detect local development:
  // - NEXT_PUBLIC_CHANNEL is "local" or "ci"
  // - OR hostname ends with .f3nation.test (Caddy local proxy)
  // - OR NODE_ENV is not production
  const isLocalDev =
    env.NEXT_PUBLIC_CHANNEL === "local" ||
    env.NEXT_PUBLIC_CHANNEL === "ci" ||
    parsedUrl.hostname.endsWith(".f3nation.test") ||
    process.env.NODE_ENV !== "production";

  if (isLocalDev) {
    // Use the PORT env var if set, otherwise default to 3000
    const port = process.env.PORT ?? "3000";
    return `http://localhost:${port}/api/otp${search}`;
  }

  // In production, use the actual URL
  return `${parsedUrl.protocol}//${parsedUrl.host}/api/otp${search}`;
}

export const sendOtpVerificationRequestServer: NodemailerConfig["sendVerificationRequest"] =
  async (params) => {
    const { identifier, url, provider, token } = params;

    const internalUrl = getInternalApiUrl({ url });

    const result = await fetch(internalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: env.SUPER_ADMIN_API_KEY,
        identifier,
        url,
        server: provider.server,
        from: provider.from,
        token,
      }),
    });

    if (!result.ok) {
      throw new Error("Failed to send verification request");
    }
  };
