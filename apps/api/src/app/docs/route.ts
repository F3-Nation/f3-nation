import { ApiReference } from "@scalar/nextjs-api-reference";

import { env } from "@acme/env";

export const GET = async () => {
  const baseUrl = env.NEXT_PUBLIC_API_URL;

  // Derive the client ID for Scalar based on the API URL
  // Local: scalar-docs-local, staging: scalar-docs-staging, prod: scalar-docs
  const apiUrl = baseUrl.replace(/\/$/, "");
  const scalarClientId = apiUrl.includes("localhost")
    ? "scalar-docs-local"
    : apiUrl.includes("staging")
      ? "scalar-docs-staging"
      : "scalar-docs";

  const redirectUri = `${apiUrl}/docs/oauth2-redirect`;

  const response = ApiReference({
    url: "/docs/openapi.json",
    baseServerURL: baseUrl,
    pageTitle: "F3 Nation API Reference",
    favicon: "/favicon.ico",
    authentication: {
      preferredSecurityScheme: "oauth2",
      securitySchemes: {
        oauth2: {
          flows: {
            authorizationCode: {
              "x-scalar-client-id": scalarClientId,
              "x-usePkce": "SHA-256",
              "x-scalar-redirect-uri": redirectUri,
            },
          },
        },
      },
    },
  })();

  return response;
};
