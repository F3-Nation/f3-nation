# @f3nation/health

Shared health contract package for F3 services.

This package provides:

- Runtime schemas (Zod) for contract validation
- TypeScript types inferred from schemas
- Helpers for check execution and response construction
- A stable contract version constant

## Install

This package is not (yet) published to npm. Add it as a workspace dependency:

```jsonc
// package.json
{
  "dependencies": {
    "@f3nation/health": "workspace:*",
  },
}
```

Also add a TypeScript path alias to your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@f3nation/health": ["../../packages/health/src/index.ts"],
    },
  },
}
```

## Quickstart

```ts
import {
  HEALTH_CONTRACT_VERSION,
  buildHealthResponse,
  healthResponseSchema,
  runChecks,
} from "@f3nation/health";

export async function GET() {
  const startedAt = Date.now();

  const checks = await runChecks([
    {
      id: "primary-database",
      defaultSeverity: "critical",
      timeoutMs: 500,
      run: async () => ({ status: "ok" }),
    },
  ]);

  const payload = buildHealthResponse({
    service: "f3-api",
    version: "2026.07.09+abc1234",
    startedAt,
    checks,
  });

  // Validate before responding
  healthResponseSchema.parse(payload);

  return Response.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
```

## HTTP requirements

The health contract covers the JSON response body, not the HTTP framework used
to send it. Every `/health` endpoint using this package must:

- return HTTP `200`
- return JSON matching `healthResponseSchema`
- set `Cache-Control: no-store`

> **Security:** `CheckRunnerResult.message` and `CheckRunnerResult.details` are
> included verbatim in the public `/health` response body. Never return secrets,
> PII, connection strings, or internal stack details from a `CheckRunner`.
> Thrown errors are caught by `runChecks` and mapped to `{ reason: "error" }`
> without exposing the original exception.

`@f3nation/health` does not enforce transport headers directly because the package is
intentionally framework-agnostic and must remain usable outside Next.js,
including from non-JavaScript stacks. Header enforcement therefore belongs in
each service endpoint implementation and its tests.

Recommended endpoint test assertions:

- response status is `200`
- `Cache-Control` header equals `no-store`
- response body validates with `healthResponseSchema`

## Exports

- `HEALTH_CONTRACT_VERSION`
- `healthStatusSchema`
- `healthSeveritySchema`
- `healthCheckSchema`
- `healthResponseSchema`
- `runChecks`
- `summarizeStatus`
- `buildHealthResponse`
- `HealthStatus`, `HealthSeverity`, `HealthCheck`, `HealthResponse`
- `CheckRunnerResult`, `CheckRunner`, `CheckSpec`

## Packaging note (workspace vs publish)

This repository uses source-first entrypoints in `packages/health/package.json`
for monorepo workspace consumers, with a `publishConfig` override to rewrite
entrypoints to compiled `dist` artifacts for published consumers.

Why this is intentional:

- workspace apps resolve quickly against source during local dev and CI
- published consumers resolve compiled JS/types from `dist`

Do not remove `publishConfig` unless the workspace build orchestration is also
changed to guarantee `dist` artifacts exist before every consumer resolves this
package.
