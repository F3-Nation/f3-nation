import { writeFile } from "node:fs/promises";
import { Storage } from "@google-cloud/storage";
import { db } from "@/db";
import { domain } from "@/db/schema";

const BUCKET = process.env.CONFIG_BUCKET ?? "f3-redirects-redirect";
const OBJECT = process.env.CONFIG_OBJECT ?? "config/redirects.json";
// Dev-only: when set, write the config to a local file instead of GCS (lets
// local development exercise the full export path without GCS credentials).
const LOCAL_PATH = process.env.EXPORT_LOCAL_PATH;

/**
 * Regenerate the flat-file config the Go redirect tier reads, from the current
 * set of registered domains in Postgres (the source of truth). Called after
 * any add/remove so the live service and the on-demand-TLS gate stay in sync.
 *
 * Auth is via Application Default Credentials — the Cloud Run runtime service
 * account (granted storage.objectAdmin on the bucket). No keys.
 */
export async function exportConfigToGCS(): Promise<number> {
  const rows = await db
    .select({ host: domain.hostname, target: domain.destinationUrl })
    .from(domain);

  const mappings = rows
    .map((r) => ({ host: r.host, target: r.target }))
    .sort((a, b) => a.host.localeCompare(b.host));

  const body = JSON.stringify({ mappings }, null, 2) + "\n";

  if (LOCAL_PATH) {
    await writeFile(LOCAL_PATH, body, "utf8");
    return mappings.length;
  }

  const storage = new Storage();
  await storage.bucket(BUCKET).file(OBJECT).save(body, {
    contentType: "application/json",
    resumable: false,
  });

  return mappings.length;
}

/**
 * Pure: of the given cert-storage object names, which belong to `host`.
 * CertMagic stores under `certs/certificates/<ca>/<host>/...`, so we match the
 * host as a whole path segment (`/<host>/`) — this correctly excludes
 * `www.<host>` when cleaning up the apex, and vice-versa.
 */
export function certObjectsForHost(names: string[], host: string): string[] {
  const seg = `/${host}/`;
  return names.filter((n) => n.includes(seg));
}

/**
 * Garbage-collect a removed host's TLS cert material from GCS so it doesn't
 * linger after the redirect is deleted. Best-effort: individual delete failures
 * are swallowed (the mapping removal + export are the critical side effects).
 * Returns the number of objects *targeted* for deletion — because failures are
 * swallowed, this is not a guaranteed count of successful deletions. No-op in
 * local dev (EXPORT_LOCAL_PATH set).
 */
export async function deleteCertsForHost(host: string): Promise<number> {
  if (LOCAL_PATH) return 0;
  const storage = new Storage();
  const [files] = await storage.bucket(BUCKET).getFiles({ prefix: "certs/" });
  const targets = files.filter(
    (f) => certObjectsForHost([f.name], host).length > 0,
  );
  await Promise.all(targets.map((f) => f.delete().catch(() => undefined)));
  return targets.length;
}
