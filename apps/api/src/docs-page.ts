import { Scalar } from "@scalar/hono-api-reference";

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
