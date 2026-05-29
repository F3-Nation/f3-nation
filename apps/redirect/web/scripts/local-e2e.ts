// Local end-to-end check of the domain-registration mechanics, exercising the
// same modules the API uses (validation, DB insert, unique-claim, DNS, export)
// without needing a Google sign-in. Run with EXPORT_LOCAL_PATH set so the
// exporter writes a local file instead of GCS.
//
//   pnpm dlx tsx scripts/local-e2e.ts
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { domain, user } from "@/db/schema";
import { dnsInstructions, registerSchema } from "@/lib/domains";
import { exportConfigToGCS } from "@/lib/gcs-export";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}

// This script truncates the `domain` and `user` tables. Refuse to run unless
// DATABASE_URL clearly points at a local/test database, so a misconfigured env
// can never wipe real data.
function assertLocalTestDb() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal =
    /@(localhost|127\.0\.0\.1|::1|host\.docker\.internal)[:/]/.test(url);
  const looksTest = /(test|f3redirect)\b/i.test(url);
  if (!url || !isLocal || !looksTest) {
    throw new Error(
      `Refusing to run destructive local-e2e: DATABASE_URL must point at a local test DB (got: ${url || "unset"}).`,
    );
  }
}

async function main() {
  assertLocalTestDb();
  const uid1 = "test-user-1";
  const uid2 = "test-user-2";
  // clean slate
  await db.delete(domain);
  await db.delete(user);
  await db.insert(user).values([
    {
      id: uid1,
      name: "User One",
      email: "one@example.com",
      emailVerified: true,
    },
    {
      id: uid2,
      name: "User Two",
      email: "two@example.com",
      emailVerified: true,
    },
  ]);

  // 1. validation rejects junk
  assert(
    !registerSchema.safeParse({
      hostname: "nodot",
      destination: "https://x.com",
    }).success,
    "rejects non-FQDN hostname",
  );
  assert(
    !registerSchema.safeParse({ hostname: "ok.com", destination: "ftp://x" })
      .success,
    "rejects non-http destination",
  );

  // 2. valid registration
  const parsed = registerSchema.parse({
    hostname: "F3Muletown.com",
    destination: "https://regions.f3nation.com/muletown",
  });
  assert(
    parsed.hostname === "f3muletown.com",
    "normalizes hostname to lowercase",
  );
  await db.insert(domain).values({
    userId: uid1,
    hostname: parsed.hostname,
    destinationUrl: parsed.destination,
  });

  // 3. another user cannot claim the same host (unique index)
  let claimed = false;
  try {
    await db.insert(domain).values({
      userId: uid2,
      hostname: "f3muletown.com",
      destinationUrl: "https://evil.example.com",
    });
  } catch (e) {
    // Only a unique-violation (Postgres 23505) counts as "already claimed";
    // any other DB error is a real failure and must not pass silently.
    const code = (e as { code?: string } | null)?.code;
    if (code !== "23505") throw e;
    claimed = true;
  }
  assert(claimed, "second account cannot claim an already-registered host");

  // 4. subdomain for a different host is fine
  await db.insert(domain).values({
    userId: uid2,
    hostname: "stats.f3muletown.com",
    destinationUrl: "https://pax-vault.f3nation.com/stats/region/35838",
  });

  // 5. DNS instructions: apex -> A, subdomain -> CNAME
  const apex = dnsInstructions("f3muletown.com");
  assert(
    apex[0].type === "A" && apex[0].name === "f3muletown.com",
    "apex yields an A record",
  );
  const sub = dnsInstructions("stats.f3muletown.com");
  assert(
    sub[0].type === "CNAME" && sub[0].value === "f3muletown.com",
    "subdomain yields a CNAME to its apex",
  );

  // 6. export to local file reflects the DB
  const n = await exportConfigToGCS();
  assert(n === 2, "export wrote 2 mappings");
  const written = JSON.parse(
    await readFile(process.env.EXPORT_LOCAL_PATH!, "utf8"),
  );
  const hosts = written.mappings.map((m: { host: string }) => m.host).sort();
  assert(
    hosts[0] === "f3muletown.com" && hosts[1] === "stats.f3muletown.com",
    "exported file matches registered domains",
  );

  // cleanup
  await db.delete(domain);
  await db.delete(user);
  console.log("\nLOCAL E2E PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
