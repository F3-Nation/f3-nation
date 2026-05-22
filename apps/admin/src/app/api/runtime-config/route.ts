import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    channel: process.env.F3_CHANNEL ?? "",
    mapUrl: process.env.F3_MAP_BASE_URL ?? "",
    googleApiKey: process.env.F3_GOOGLE_API_KEY ?? "",
  });
}
