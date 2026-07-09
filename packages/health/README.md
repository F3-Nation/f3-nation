# f3-health

Shared health contract package for F3 services.

This package provides:

- Runtime schemas (Zod) for contract validation
- TypeScript types inferred from schemas
- Helpers for check execution and response construction
- A stable contract version constant

## Install

```bash
pnpm add f3-health zod
```

## Quickstart

```ts
import {
  HEALTH_CONTRACT_VERSION,
  buildHealthResponse,
  healthResponseSchema,
  runChecks,
} from "f3-health";

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
```

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
