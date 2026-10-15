import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkEmailCode } from "~/lib/email-mfa";
import { logError } from "~/lib/logging";
import { env } from "~/env";
import { rateLimit } from "~/lib/rate-limit";

interface RegisterBody {
  email?: string;
  /** The emailed sign-in code — proof the caller owns `email`. */
  code?: string;
  f3Name?: string;
  firstName?: string;
  lastName?: string;
  homeRegionId?: number;
  phone?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  emergencyNotes?: string;
}

/** The emailed sign-in code is always six digits. */
const codeSchema = z.string().regex(/^\d{6}$/);

/** Strip the +1 country code from US E.164 numbers — most users are US-based
 *  and the DB stores bare 10-digit numbers for domestic numbers. */
function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  return phone.startsWith("+1") ? phone.slice(2).trim() : phone;
}

export async function POST(request: NextRequest) {
  // The last hop is the one our proxy appended; earlier hops are caller-set.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  const { allowed } = rateLimit(`register:${ip}`, 5, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await request.json()) as RegisterBody;

  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) {
    return NextResponse.json(
      { error: "Valid email is required" },
      { status: 400 },
    );
  }

  if (!body.firstName?.trim() || !body.lastName?.trim()) {
    return NextResponse.json(
      { error: "First name and last name are required" },
      { status: 400 },
    );
  }

  const email = body.email.toLowerCase().trim();

  // Proof of email ownership: the code we emailed to this address. Checked
  // without consuming it, so the sign-in right after registration still
  // works. Without this, anyone could create an account for any email.
  const code = codeSchema.safeParse(body.code);
  let ownsEmail = false;
  if (code.success) {
    try {
      ownsEmail = await checkEmailCode(email, code.data);
    } catch (err) {
      logError("auth.register.code_check_failed", {}, err);
      return NextResponse.json(
        { error: "Unable to verify your code. Please try again." },
        { status: 503 },
      );
    }
  }
  if (!ownsEmail) {
    return NextResponse.json(
      {
        error:
          "Your verification code is invalid or has expired. Please sign in again.",
      },
      { status: 401 },
    );
  }

  const payload = {
    email,
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    ...(body.f3Name?.trim() && { f3Name: body.f3Name.trim() }),
    ...(body.homeRegionId && { homeRegionId: body.homeRegionId }),
    ...(body.phone?.trim() && { phone: normalizePhone(body.phone.trim()) }),
    ...(body.emergencyContact?.trim() && {
      emergencyContact: body.emergencyContact.trim(),
    }),
    ...(body.emergencyPhone?.trim() && {
      emergencyPhone: normalizePhone(body.emergencyPhone.trim()),
    }),
    ...(body.emergencyNotes?.trim() && {
      emergencyNotes: body.emergencyNotes.trim(),
    }),
    emailVerified: new Date().toISOString(),
    // Mark onboarding complete at creation time so the OAuth authorize flow
    // never redirects a newly registered user to /onboarding.
    meta: { onboarding_completed: true },
    roles: [],
  };

  try {
    const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/v1/user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.API_KEY}`,
        client: env.NEXT_PUBLIC_AUTH_URL,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      logError("auth.register.f3_api_failed", {
        status: res.status,
        statusText: res.statusText,
        responseText: text.slice(0, 500),
      });
      return NextResponse.json(
        { error: "Failed to create account. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ created: true });
  } catch (err) {
    logError("auth.register.f3_api_error", {}, err);
    return NextResponse.json(
      { error: "Unable to reach the registration service. Please try again." },
      { status: 502 },
    );
  }
}
