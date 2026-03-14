import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getClient } from "~/lib/oauth";

/**
 * Build CORS headers from the client's allowed_origin
 */
export async function getCorsHeaders(
  request: NextRequest,
  clientId?: string,
): Promise<Record<string, string>> {
  const origin = request.headers.get("origin");
  if (!origin) return {};

  // If we have a clientId, look up the allowed origin
  if (clientId) {
    const client = await getClient(clientId);
    if (client && client.allowedOrigin === origin) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
        "Access-Control-Allow-Credentials": "true",
      };
    }
  }

  // For non-client-specific requests, allow same-origin
  return {};
}

/**
 * Handle OPTIONS preflight
 */
export function handlePreflight(headers: Record<string, string>) {
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}
