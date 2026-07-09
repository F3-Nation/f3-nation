## Status Monitors (`/status`)

The `/status` page supports two monitor types:

- `contract`: native F3 `/health` responses validated with `@f3nation/health`
- `external`: third-party provider adapters (for example Slack)

### Where status monitor config lives

Edit `status-targets.ts` in this directory.

This file controls which services/providers appear on `/status`.

### Adding another external provider

Adding a provider is more than extending the string union. Use this checklist:

1. Extend provider type

- File: `../../lib/status.ts`
- Update `ExternalProvider` to include the new provider name.

2. Add provider adapter logic

- File: `../../lib/status.ts`
- Add provider-specific payload parsing and mapping into shared states:
  - `ok`
  - `degraded`
  - `down`
- Normalize parse/network failures into deterministic reasons (for example `invalid_json`, `unreachable`).

3. Update adapter dispatch

- File: `../../lib/status.ts`
- Extend `fetchExternalStatus(...)` dispatch so your provider routes to its parser/mapper.
- Keep unknown/invalid configuration paths deterministic with `invalid_monitor_config`.

4. Add provider config entry

- File: `status-targets.ts`
- Add a target with:
  - `source: "external"`
  - `provider: "<your-provider>"`
  - `apiUrl` for the provider's status endpoint
  - user-facing `label` and `url`

5. Add test coverage

- File: `../../lib/status.test.ts`
  - success mapping for representative provider responses
  - failure mapping (network/invalid json)
  - invalid config path (`invalid_monitor_config`)
- File: `status-card.test.tsx`
  - verify monitor source/type rendering and external detail rendering

### Slack provider example

Current pilot implementation:

- Target config: `status-targets.ts`
- Adapter logic: `../../lib/status.ts`

Slack JSON is fetched from `https://slack-status.com/api/v2.0.0/current` and mapped into shared status semantics so it renders alongside contract-based services.
