import { NextResponse } from "next/server";

// Read runtime env (e.g. F3_GOOGLE_API_KEY) from the running container on every
// request, never at build. This is the single dynamic surface that lets the rest
// of the app (layout + `/`) be statically cached/ISR'd. It does no DB work, so it
// stays cheap even though it is force-dynamic.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    channel: process.env.F3_CHANNEL ?? "local",
    googleApiKey: process.env.F3_GOOGLE_API_KEY ?? "",
    adminUrl: process.env.F3_ADMIN_URL ?? "",
  });
}
