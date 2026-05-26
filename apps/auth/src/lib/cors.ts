import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { oauthClients } from "@acme/db/schema/schema";

import { db } from "~/lib/db";
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

  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
    "Access-Control-Allow-Credentials": "true",
  };

  // If we have a clientId, look up the allowed origin directly
  if (clientId) {
    const client = await getClient(clientId);
    if (client?.allowedOrigin === origin) {
      return headers;
    }
    return {};
  }

  // For preflight (no client_id), look up any active client with this origin
  const [client] = await db
    .select({ id: oauthClients.id })
    .from(oauthClients)
    .where(eq(oauthClients.allowedOrigin, origin))
    .limit(1);

  if (client) {
    return headers;
  }

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
