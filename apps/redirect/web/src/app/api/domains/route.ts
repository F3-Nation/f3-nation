import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domain } from "@/db/schema";
import { dnsInstructions, registerSchema } from "@/lib/domains";
import { exportConfigToGCS } from "@/lib/gcs-export";

async function requireUserId(): Promise<string | null> {
  const sess = await auth.api.getSession({ headers: await headers() });
  return sess?.user?.id ?? null;
}

// GET /api/domains — list the signed-in user's domains.
export async function GET() {
  const userId = await requireUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(domain)
    .where(eq(domain.userId, userId))
    .orderBy(domain.hostname);

  return NextResponse.json({
    domains: rows.map((r) => ({
      id: r.id,
      hostname: r.hostname,
      destination: r.destinationUrl,
      createdAt: r.createdAt,
      dns: dnsInstructions(r.hostname),
    })),
  });
}

// POST /api/domains — register a custom domain for the signed-in user.
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = registerSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }
  const { hostname, destination } = parsed.data;

  // Already claimed (by anyone)?
  const existing = await db
    .select()
    .from(domain)
    .where(eq(domain.hostname, hostname))
    .limit(1);
  if (existing.length > 0) {
    const mine = existing[0]?.userId === userId;
    return NextResponse.json(
      {
        error: mine
          ? "you have already registered this domain"
          : "this domain is already claimed by another account",
      },
      { status: 409 },
    );
  }

  let inserted: typeof domain.$inferSelect | undefined;
  try {
    [inserted] = await db
      .insert(domain)
      .values({ userId, hostname, destinationUrl: destination })
      .returning();
  } catch {
    // Unique index race → treat as claimed.
    return NextResponse.json(
      { error: "this domain is already claimed" },
      { status: 409 },
    );
  }
  if (!inserted) {
    return NextResponse.json(
      { error: "failed to register domain" },
      { status: 500 },
    );
  }

  await exportConfigToGCS();

  return NextResponse.json(
    {
      domain: {
        id: inserted.id,
        hostname: inserted.hostname,
        destination: inserted.destinationUrl,
        dns: dnsInstructions(inserted.hostname),
      },
    },
    { status: 201 },
  );
}
