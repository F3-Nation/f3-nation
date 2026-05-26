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
 */
export async function emulatorFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer local-dev-token",
      ...init?.headers,
    },
  });
}
