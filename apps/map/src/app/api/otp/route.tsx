import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { SendVerificationRequestServerParams } from "@acme/auth/lib/send-otp-verification-request-server";
import { localEmailProvider } from "@acme/auth/lib/email-provider";
import { constantTimeEqual } from "@acme/shared/server/constant-time-equal";
import { env } from "~/env";

import { sendVerificationRequest } from "./send-verification-request";

// constantTimeEqual needs node:crypto.
export const runtime = "nodejs";

/** True when `url` parses and shares the map app's configured origin. */
function isMapUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return new URL(url).origin === new URL(env.F3_MAP_BASE_URL).origin;
  } catch {
    return false;
  }
}

export const POST = async (req: NextRequest) => {
  // SMTP server and sender come from this app's own config, never the body.
  const { identifier, url, apiKey, token } = (await req.json()) as Partial<
    Pick<
      SendVerificationRequestServerParams,
      "identifier" | "url" | "apiKey" | "token"
    >
  >;
  if (!constantTimeEqual(apiKey, env.SUPER_ADMIN_API_KEY)) {
    return NextResponse.json({ success: false }, { status: 401 });
  }
  if (!isMapUrl(url)) {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  try {
    await sendVerificationRequest({
      identifier: identifier ?? "",
      url,
      // @auth/core types the configured server as `any`; email-provider.ts
      // always sets it to a connection string.
      server: localEmailProvider.server as string,
      from: localEmailProvider.from,
      token: token ?? "",
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("sendVerificationRequest failed:", err);
    return NextResponse.json({ success: false }, { status: 500 });
  }
};
