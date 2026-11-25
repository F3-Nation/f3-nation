/**
 * Whether a GCS call failed with HTTP 403: the credentials the client runs
 * with (the service's identity, or a key) lack permission on the bucket or
 * object. Callers report this separately from other failures because the fix
 * is a GCP IAM grant, not a retry.
 */
export function isStorageAccessDenied(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, status, response } = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  return code === 403 || status === 403 || response?.status === 403;
}
