/** Derives the externally-visible base URL from proxy headers, falling back to the request's own URL. */
export function getBaseUrl(request: Request): string {
  const envBase = process.env.NEXT_PUBLIC_API_URL ?? undefined;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? undefined;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? undefined;
  const url = new URL(request.url);
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  const derivedBase = `${proto}://${host}`;
  return (envBase ?? derivedBase).replace(/\/$/, "");
}
