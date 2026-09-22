import { Scalar } from "@scalar/hono-api-reference";

// Kept out of docs.ts deliberately: docs.ts is still imported by the Next
// route it was moved from (apps/api/src/app/docs/openapi.json/route.ts stays
// deployed until phase 3+4), and that Next process has no reason to pull in
// @scalar/hono-api-reference. This file is Hono-only, imported by app.ts.
function getDocsBaseUrl(): string | undefined {
  const trimmed = process.env.NEXT_PUBLIC_API_URL?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

export const docsPage = Scalar({
  url: "/docs/openapi.json",
  baseServerURL: getDocsBaseUrl(),
  pageTitle: "F3 Nation API Reference",
  favicon: "/favicon.ico",
});
