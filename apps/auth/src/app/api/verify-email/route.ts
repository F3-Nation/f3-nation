import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sendEmailCode, verifyEmailCode } from "~/lib/email-mfa";
import { rateLimit } from "~/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed } = rateLimit(`verify-email:${ip}`, 10, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await request.json()) as {
    email?: string;
    code?: string;
    action?: string;
  };

  if (!body.email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const email = body.email.toLowerCase().trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 },
    );
  }

  // Send code
  if (body.action === "send" || !body.code) {
    try {
      await sendEmailCode(email);
      return NextResponse.json({ sent: true });
    } catch (err: unknown) {
      // Log the real error for GCP observability
      console.error(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Unknown error",
          stack: err instanceof Error ? err.stack : undefined,
        }),
      );
      // Return a generic message to avoid leaking internal details
      return NextResponse.json(
        {
          error: "Failed to send verification code. Please try again.",
        },
        { status: 500 },
      );
    }
  }

  // Verify code
  const user = await verifyEmailCode(email, body.code);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid or expired code" },
      { status: 401 },
    );
  }

  return NextResponse.json({ verified: true, userId: user.id });
}
