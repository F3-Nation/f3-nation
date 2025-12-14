import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { SendVerificationRequestServerParams } from "@acme/auth/lib/send-otp-verification-request-server";
import { env } from "@acme/env";

import { sendVerificationRequest } from "./send-verification-request";

export const POST = async (req: NextRequest) => {
  const { identifier, url, server, from, apiKey, token } =
    (await req.json()) as SendVerificationRequestServerParams;
  if (apiKey !== env.SUPER_ADMIN_API_KEY) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  await sendVerificationRequest({
    identifier,
    url,
    server,
    from,
    token,
  });
  return NextResponse.json({ success: true });
};
