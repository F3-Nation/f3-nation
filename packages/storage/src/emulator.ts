/**
 * Returns the GCS emulator host (e.g. "localhost:4443") when running in a
 * local Docker environment, or null in production.
 */
export function getEmulatorHost(): string | null {
  return process.env.GCS_EMULATOR_HOST ?? null;
}

/**
 * Perform a request against the fake-gcs emulator, injecting the shared dev
 * token. Callers only need to supply the method, any extra headers, and body.
 *
 * Headers are normalized via `new Headers()` so any valid `HeadersInit` shape
 * (object, `Headers` instance, or `string[][]`) is handled correctly before
 * the Authorization entry is set.
 */
export async function emulatorFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", "Bearer local-dev-token");
  return fetch(url, { ...init, headers });
}
