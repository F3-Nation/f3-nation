import { NextResponse } from "next/server";

import { getJWKS } from "~/lib/jwt";

export async function GET() {
  const jwks = await getJWKS();
  return NextResponse.json(jwks, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
