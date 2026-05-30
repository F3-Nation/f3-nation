import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { db } from "~/lib/db";
import { env } from "~/env";
import { rateLimit } from "~/lib/rate-limit";

interface RegisterBody {
  email?: string;
  f3Name?: string;
  firstName?: string;
  lastName?: string;
  homeRegionId?: number;
  phone?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  emergencyNotes?: string;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
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

  const payload = {
    email: body.email.toLowerCase().trim(),
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    ...(body.f3Name?.trim() && { f3Name: body.f3Name.trim() }),
    ...(body.homeRegionId && { homeRegionId: body.homeRegionId }),
    ...(body.phone?.trim() && { phone: body.phone.trim() }),
    ...(body.emergencyContact?.trim() && {
      emergencyContact: body.emergencyContact.trim(),
    }),
    ...(body.emergencyPhone?.trim() && {
      emergencyPhone: body.emergencyPhone.trim(),
    }),
    ...(body.emergencyNotes?.trim() && {
      emergencyNotes: body.emergencyNotes.trim(),
    }),
    emailVerified: new Date().toISOString(),
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
      console.error("Failed to create user via F3 API:", text);
      return NextResponse.json(
        { error: "Failed to create account. Please try again." },
        { status: 502 },
      );
    }

    // Mark onboarding complete so the OAuth authorize flow doesn't redirect
    // the newly registered user to /onboarding.
    // This is best-effort — a failure here must not mask the successful registration.
    try {
      const email = payload.email;
      const [dbUser] = await db
        .select({ id: users.id, meta: users.meta })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (dbUser) {
        const updatedMeta = {
          ...((dbUser.meta as Record<string, unknown>) ?? {}),
          onboarding_completed: true,
        };
        await db
          .update(users)
          .set({ meta: updatedMeta })
          .where(eq(users.id, dbUser.id));
      } else {
        // The F3 API succeeded but the user isn't visible in the local DB yet
        // (e.g. replication lag or casing mismatch). The user will see /onboarding
        // once and it will set the flag at that point.
        console.warn(
          JSON.stringify({
            event: "register.onboarding_flag_skipped",
            reason: "user not found in local DB after F3 API creation",
            email,
          }),
        );
      }
    } catch (dbErr) {
      // Non-fatal — log and continue so the user gets { created: true }.
      console.error(
        JSON.stringify({
          event: "register.onboarding_flag_error",
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        }),
      );
    }

    return NextResponse.json({ created: true });
  } catch (err) {
    console.error("Error calling F3 API:", err);
    return NextResponse.json(
      { error: "Unable to reach the registration service. Please try again." },
      { status: 502 },
    );
  }
}
