import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { getAccessToken } from "~/lib/auth/server";

const PROXY_PREFIX = "/api/orpc";

function getApiBaseUrl(): string {
  const baseUrl =
    process.env.F3_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl)
    throw new Error("F3_API_BASE_URL or NEXT_PUBLIC_API_URL is required");

  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith(API_PREFIX_V1)
    ? normalized.slice(0, -API_PREFIX_V1.length)
    : normalized;
}

function getTargetUrl(request: NextRequest): URL {
  const sourceUrl = new URL(request.url);
  const proxiedPath = sourceUrl.pathname.slice(PROXY_PREFIX.length);
  const targetUrl = new URL(
    `${getApiBaseUrl()}${proxiedPath || API_PREFIX_V1}`,
  );
  targetUrl.search = sourceUrl.search;
  return targetUrl;
}

function getForwardedHeaders(
  request: NextRequest,
  accessToken: string,
): Headers {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("host");
  headers.delete("content-length");
  headers.set(Header.Client, Client.ORPC);
  headers.set(Header.Authorization, `Bearer ${accessToken}`);
  return headers;
}

async function proxyRequest(request: NextRequest) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  return fetch(getTargetUrl(request), {
    method,
    headers: getForwardedHeaders(request, accessToken),
    body: hasBody ? request.body : undefined,
    // Required by fetch when streaming the incoming request body.
    duplex: hasBody ? "half" : undefined,
  } as RequestInit & { duplex?: "half" });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;
