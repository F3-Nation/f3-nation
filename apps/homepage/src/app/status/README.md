# Status Monitors (`/status`)

The `/status` page supports two monitor types:

- `contract`: native F3 `/health` responses validated with `@f3nation/health`
- `external`: third-party provider adapters (for example Slack)

### Where status monitor config lives

Status target configuration now lives in the API aggregator:

- `packages/api/src/router/status-targets.ts`

Homepage `/status` consumes aggregated results from `GET /v1/status` and does
not define monitor targets locally.

### Adding another external provider

Adding a provider is more than extending the string union. Use this checklist:

1. Extend provider type

- File: `packages/health/src/index.ts`
- Update `ExternalProvider` to include the new provider name.

1. Add provider adapter logic

- File: `packages/api/src/router/status.ts`
- Add provider-specific payload parsing and mapping into shared states:
  - `ok`
  - `degraded`
  - `down`
- Normalize parse/network failures into deterministic reasons (for example `invalid_json`, `unreachable`).

1. Update adapter dispatch

- File: `packages/api/src/router/status.ts`
- Extend `fetchExternalStatus(...)` dispatch so your provider routes to its parser/mapper.
- Keep unknown/invalid configuration paths deterministic with `invalid_monitor_config`.

1. Add provider config entry

- File: `packages/api/src/router/status-targets.ts`
- Add a target with:
  - `source: "external"`
  - `provider: "<your-provider>"`
  - `apiUrl` for the provider's status endpoint
  - user-facing `label` and `url`

1. Add test coverage

- File: `packages/api/src/router/status.test.ts`
  - success mapping for representative provider responses
  - failure mapping (network/invalid json)
  - invalid config path (`invalid_monitor_config`)
- File: `status-card.test.tsx`
  - verify monitor source/type rendering and external detail rendering

### Slack provider example

Current pilot implementation:

- Target config: `packages/api/src/router/status-targets.ts`
- Adapter logic: `packages/api/src/router/status.ts`

Slack JSON is fetched from `https://slack-status.com/api/v2.0.0/current` and mapped into shared status semantics so it renders alongside contract-based services.
