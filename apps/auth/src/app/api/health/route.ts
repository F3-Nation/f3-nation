import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "~/lib/db";
import { getJWKS } from "~/lib/jwt";

export const dynamic = "force-dynamic";

interface CheckResult {
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

async function checkDatabase(): Promise<CheckResult> {
  const start = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      status: "error",
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

async function checkJwks(): Promise<CheckResult> {
  const start = performance.now();
  try {
    const jwks = await getJWKS();
    if (!jwks.keys.length) throw new Error("No keys in JWKS");
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      status: "error",
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export async function GET() {
  const [database, jwks] = await Promise.all([checkDatabase(), checkJwks()]);

  const checks = { database, jwks };
  const healthy = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 },
  );
}
