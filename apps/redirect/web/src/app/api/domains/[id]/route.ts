import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { domain } from "@/db/schema";
import { dnsInstructions, updateSchema } from "@/lib/domains";
import { deleteCertsForHost, exportConfigToGCS } from "@/lib/gcs-export";

async function requireUserId(): Promise<string | null> {
  const sess = await auth.api.getSession({ headers: await headers() });
  return sess?.user?.id ?? null;
}

// PUT /api/domains/:id — update the redirect destination (owner only).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const [updated] = await db
    .update(domain)
    .set({ destinationUrl: parsed.data.destination })
    .where(and(eq(domain.id, id), eq(domain.userId, userId)))
    .returning();

  if (!updated)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  await exportConfigToGCS();

  return NextResponse.json({
    domain: {
      id: updated.id,
      hostname: updated.hostname,
      destination: updated.destinationUrl,
      dns: dnsInstructions(updated.hostname),
    },
  });
}

// DELETE /api/domains/:id — remove one of the signed-in user's domains, then
// garbage-collect its TLS cert material from GCS.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const [deleted] = await db
    .delete(domain)
    .where(and(eq(domain.id, id), eq(domain.userId, userId)))
    .returning();

  if (!deleted)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  await exportConfigToGCS();
  // Best-effort cert cleanup — never fail the request on this.
  let certsRemoved = 0;
  try {
    certsRemoved = await deleteCertsForHost(deleted.hostname);
  } catch {
    certsRemoved = 0;
  }

  return NextResponse.json({ ok: true, certsRemoved });
}
