/** Base URL for the API: `NEXT_PUBLIC_API_URL` if set, else derived from proxy headers (`x-forwarded-proto`/`x-forwarded-host`) or the request's own URL. */
export function getBaseUrl(request: Request): string {
  const trimmedApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  let envBase: string | undefined;
  if (trimmedApiUrl !== undefined && trimmedApiUrl.length > 0) {
    envBase = trimmedApiUrl;
  }
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? undefined;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? undefined;
  const url = new URL(request.url);
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  const derivedBase = `${proto}://${host}`;
  return (envBase ?? derivedBase).replace(/\/$/, "");
}
