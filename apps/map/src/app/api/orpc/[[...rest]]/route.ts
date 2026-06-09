import type { NextRequest } from "next/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

const PROXY_PREFIX = "/api/orpc";

function getApiBaseUrl(): string {
  const baseUrl = process.env.F3_API_BASE_URL;
  if (!baseUrl) throw new Error("F3_API_BASE_URL is required");

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

function getForwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.set(Header.Client, Client.ORPC);

  const mapApiKey = process.env.F3_MAP_API_KEY;
  if (mapApiKey) {
    headers.set(Header.Authorization, `Bearer ${mapApiKey}`);
  }

  return headers;
}

async function proxyRequest(request: NextRequest) {
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  return fetch(getTargetUrl(request), {
    method,
    headers: getForwardedHeaders(request),
    body,
  });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;
