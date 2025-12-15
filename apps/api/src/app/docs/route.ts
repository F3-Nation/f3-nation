import { ApiReference } from "@scalar/nextjs-api-reference";

import { env } from "@acme/env";

export const GET = async () => {
  const baseUrl = env.NEXT_PUBLIC_API_URL;
  const response = ApiReference({
    url: "/docs/openapi.json",
    baseServerURL: baseUrl,
    pageTitle: "F3 Nation API Reference",
  })();

  return response;
};
