/**
 * One-time data migration: bring every existing user avatar behind the
 * canonical F3 public-image GCS bucket.
 *
 * Context: PR #260 restricts `users.avatar_url` (write path, /me router) to the
 * GCS public-image bucket. Existing rows may still hold legacy/external URLs
 * (the original F3 system, Slack, gravatar, ...). Until those are migrated, an
 * affected user editing any profile field would fail validation when the client
 * round-trips their current avatarUrl. This script fetches each non-conforming
 * avatar, re-encodes it to the same 512x512 JPEG the upload route produces, and
 * stores it at the canonical path `user-avatars/{userId}.jpg`, then rewrites the
 * DB value to the resulting bucket URL.
 *
 * This is a DATA backfill, not a Drizzle schema migration — it lives alongside
 * the other one-off scripts (seed/reset/update-db) and is run manually.
 *
 *   # Preview only (no DB writes, no uploads):
 *   pnpm db:backfill:avatars
 *
 *   # Apply: fetch, upload, and rewrite avatar_url:
 *   pnpm db:backfill:avatars -- --execute
 *
 *   # Also null out avatars that can't be fetched (dead/404 URLs) so the
 *   # stricter validation has no non-conforming rows left behind:
 *   pnpm db:backfill:avatars -- --execute --null-failed
 *
 *   # Limit the batch (useful for a first canary run):
 *   pnpm db:backfill:avatars -- --execute --limit 25
 *
 * Requires GCS_CREDENTIALS + GCS_BUCKET in the environment (same as the app).
 */
import { prepareImageForStorage, uploadFile } from "@acme/storage";
import { isAllowedAvatarUrl } from "@acme/shared/app/avatar";

import { eq, isNotNull } from ".";
import { schema } from ".";
import { db } from "./client";

interface BackfillOptions {
  /** When false (default) the script only reports — no uploads, no DB writes. */
  execute: boolean;
  /** When true, avatars that can't be fetched have their URL set to null. */
  nullFailed: boolean;
  /** Optional cap on how many rows to process this run. */
  limit: number | null;
}

interface RowResult {
  userId: number;
  oldUrl: string;
  outcome: "migrated" | "skipped-conforming" | "failed" | "nulled";
  detail?: string;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 15 * 1024 * 1024; // refuse anything larger than 15 MB

function parseArgs(argv: string[]): BackfillOptions {
  const limitArg = argv.find((a) => a.startsWith("--limit"));
  const limitValue = limitArg?.includes("=")
    ? limitArg.split("=")[1]
    : argv[argv.indexOf("--limit") + 1];
  const limit =
    limitArg && limitValue && /^\d+$/.test(limitValue)
      ? Number(limitValue)
      : null;
  return {
    execute: argv.includes("--execute"),
    nullFailed: argv.includes("--null-failed"),
    limit,
  };
}

/**
 * Reject anything that is not a plain http(s) URL pointing at a public host.
 * This is a one-time admin-run fetch of user-supplied URLs, so we apply a
 * conservative SSRF guard: https/http only, and no obviously-internal hosts.
 */
function isFetchableExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  const isPrivateOrLoopback =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host.startsWith("10.") ||
    host.startsWith("127.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    // 172.16.0.0 – 172.31.255.255 (private range)
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return !isPrivateOrLoopback;
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "image/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error("empty response body");
    if (buf.byteLength > MAX_BYTES)
      throw new Error(`image too large (${buf.byteLength} bytes)`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function migrateRow(
  row: { id: number; avatarUrl: string },
  opts: BackfillOptions,
): Promise<RowResult> {
  const { id: userId, avatarUrl: oldUrl } = row;

  if (!isFetchableExternalUrl(oldUrl)) {
    if (opts.execute && opts.nullFailed) {
      await db
        .update(schema.users)
        .set({ avatarUrl: null })
        .where(eq(schema.users.id, userId));
      return { userId, oldUrl, outcome: "nulled", detail: "unfetchable URL" };
    }
    return { userId, oldUrl, outcome: "failed", detail: "unfetchable URL" };
  }

  let newUrl: string;
  try {
    const original = await fetchImageBytes(oldUrl);
    const jpeg = await prepareImageForStorage(original, {
      width: 512,
      height: 512,
    });
    if (!opts.execute) {
      return {
        userId,
        oldUrl,
        outcome: "migrated",
        detail: "(dry-run, no upload)",
      };
    }
    newUrl = await uploadFile(
      `user-avatars/${userId}.jpg`,
      jpeg,
      "image/jpeg",
      {
        cacheControl: "public, max-age=300",
      },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    if (opts.execute && opts.nullFailed) {
      await db
        .update(schema.users)
        .set({ avatarUrl: null })
        .where(eq(schema.users.id, userId));
      return { userId, oldUrl, outcome: "nulled", detail };
    }
    return { userId, oldUrl, outcome: "failed", detail };
  }

  await db
    .update(schema.users)
    .set({ avatarUrl: newUrl })
    .where(eq(schema.users.id, userId));
  return { userId, oldUrl, outcome: "migrated", detail: newUrl };
}

export async function backfillAvatarUrls(
  opts: BackfillOptions,
): Promise<RowResult[]> {
  const rows = await db
    .select({ id: schema.users.id, avatarUrl: schema.users.avatarUrl })
    .from(schema.users)
    .where(isNotNull(schema.users.avatarUrl));

  const candidates = rows
    .filter(
      (r): r is { id: number; avatarUrl: string } =>
        typeof r.avatarUrl === "string" && r.avatarUrl.length > 0,
    )
    .filter((r) => !isAllowedAvatarUrl(r.avatarUrl));

  const batch =
    opts.limit !== null ? candidates.slice(0, opts.limit) : candidates;

  console.log(
    `Found ${rows.length} user(s) with an avatar; ${candidates.length} non-conforming; processing ${batch.length}` +
      (opts.execute ? " (EXECUTE)" : " (DRY RUN — no writes)") +
      (opts.nullFailed ? " [--null-failed]" : ""),
  );

  const results: RowResult[] = [];
  // Sequential: keeps memory flat and is gentle on the external hosts we fetch.
  for (const row of batch) {
    const result = await migrateRow(row, opts);
    results.push(result);
    console.log(
      `  user ${result.userId}: ${result.outcome}${result.detail ? ` — ${result.detail}` : ""}`,
    );
  }
  return results;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const results = await backfillAvatarUrls(opts);

  const tally = results.reduce<Record<RowResult["outcome"], number>>(
    (acc, r) => {
      acc[r.outcome] += 1;
      return acc;
    },
    { migrated: 0, "skipped-conforming": 0, failed: 0, nulled: 0 },
  );

  console.log("\nSummary:");
  console.log(`  migrated: ${tally.migrated}`);
  console.log(`  nulled:   ${tally.nulled}`);
  console.log(`  failed:   ${tally.failed}`);
  if (!opts.execute) {
    console.log("\nDry run only — re-run with --execute to apply changes.");
  } else if (tally.failed > 0) {
    console.log(
      "\nSome avatars could not be fetched. Re-run with --null-failed to clear them,\n" +
        "or migrate them manually before enabling strict validation.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("Avatar backfill failed:", err);
    process.exit(1);
  });
