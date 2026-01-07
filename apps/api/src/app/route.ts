export async function GET(request: Request) {
  const url = new URL(request.url);
  const envBase = process.env.NEXT_PUBLIC_API_URL ?? undefined;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? undefined;
  const forwardedHost = request.headers.get("x-forwarded-host") ?? undefined;
  const host = forwardedHost ?? request.headers.get("host") ?? url.host;
  const proto = forwardedProto ?? url.protocol.replace(":", "");
  const derivedBase = `${proto}://${host}`;
  let baseUrl = (envBase ?? derivedBase).replace(/\/$/, "");
  if (!baseUrl.endsWith("/api")) {
    baseUrl = `${baseUrl}/api`;
  }
  return Response.redirect(`${baseUrl}/docs`);
}
