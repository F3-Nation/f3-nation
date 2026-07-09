# Health contract and unified status dashboard

> Human designer: Tackle (@taterhead247)

## 1. Summary

F3 maintains one shared health contract package and one unified status page so operators and contributors can reliably see service health across sanctioned apps without bespoke parsing logic per app. The feature standardizes `/health` responses through `packages/health` and renders a consistent `/status` experience in `apps/homepage`, including degraded/down reasons when a service is unreachable or returns invalid contract data.
The `/status` page also supports selected third-party services via external monitor adapters when those services do not provide the F3
health contract natively.

## 2. Context & links

- App(s) affected: all monorepo apps, if possible. Non-monorepo apps may also be included.
- Package(s) affected: **packages/health**.
- Key code:
  - `packages/health/src/index.ts` (schemas, types, check helpers, response builder)
  - `apps/homepage/src/app/status/*` (status route, data fetch, rendering)
  - each app's `/health` endpoint implementation (contract producer)

## 3. User stories

- As an **operator**, I want one status page for all sanctioned apps so that I can quickly detect outages and degraded dependencies.
- As an **operator**, I want key third-party dependencies represented so that I
  can see external outages in the same operational view.
- As a **service maintainer**, I want a shared contract package so that my app's `/health` response is validated and consistent with every other app.
- As a **contributor**, I want deterministic error classification (`unreachable`, `invalid_json`, `invalid_contract`, `unsupported_contract_version`) so that monitoring behavior is predictable and testable.

## 4. Acceptance criteria (testable, non-contradictory)

### Contract package (`packages/health`)

- **AC-1** — GIVEN a valid health payload WHEN parsed with `healthResponseSchema.safeParse` THEN parsing succeeds and the payload exposes required fields: `service`, `version`, `contractVersion`, `status`, `timestamp`, `durationMs`, and non-empty `checks`.
- **AC-2** — GIVEN an invalid health payload (missing required field, invalid enum, negative duration, or malformed timestamp) WHEN parsed with `healthResponseSchema.safeParse` THEN parsing fails with schema issues.
- **AC-3** — GIVEN `runChecks` executes check specs WHEN a check throws THEN the returned check item is normalized to structured failure (`status: down`) without exposing raw exception message, stack trace, or secrets by default.
- **AC-4** — GIVEN `runChecks` executes a check with `timeoutMs` WHEN timeout is exceeded THEN the returned check item is `status: down` with timeout reason details.
- **AC-5** — GIVEN a set of checks WHEN `summarizeStatus` is called THEN result is:
  - `down` if any `critical` check is `down`
  - `degraded` if at least one check is non-`ok` and no critical-down exists
  - `ok` if all checks are `ok`
- **AC-6** — GIVEN `buildHealthResponse` input WHEN response is built THEN `contractVersion` equals package constant, `timestamp` is ISO UTC, and `durationMs` is non-negative.

### Service producers (`/health` in each app)

- **AC-7** — GIVEN any sanctioned service WHEN `/health` is requested THEN response is HTTP `200`, JSON, includes `Cache-Control: no-store`, and validates against `healthResponseSchema`.
- **AC-8** — GIVEN a service has partial dependency failure WHEN `/health` is requested THEN body `status` reflects contract semantics (`degraded` for warning/info issues; `down` for critical failures), regardless of HTTP status code.

### Status consumer (`apps/homepage/status`)

- **AC-9** — GIVEN homepage status polling receives network failure or timeout WHEN evaluating a service THEN service is rendered as `down` with reason `unreachable`.
- **AC-10** — GIVEN homepage status polling receives non-JSON response WHEN evaluating a service THEN service is rendered as `down` with reason `invalid_json`.
- **AC-11** — GIVEN homepage status polling receives JSON that fails contract validation WHEN evaluating a service THEN service is rendered as `down` with reason `invalid_contract`.
- **AC-12** — GIVEN homepage status polling receives valid contract JSON with unsupported contract major version WHEN evaluating a service THEN service is rendered as `down` with reason `unsupported_contract_version`.
- **AC-13** — GIVEN homepage status polling receives valid and supported contract JSON WHEN evaluating a service THEN rendered service status equals body `status` and displays check-level degradation/failure details, last updated timestamp, and contract version.
- **AC-14** — GIVEN a configured third-party monitor (without native `healthResponseSchema`) WHEN homepage evaluates that monitor THEN `/status` maps provider response into the same rendered status model (`ok`, `degraded`, `down`) with a monitor type label indicating external/synthetic source.
- **AC-15** — GIVEN a third-party monitor configuration is invalid or missing required adapter settings WHEN `/status` starts polling THEN the monitor is rendered as `down` with reason `invalid_monitor_config` and does not crash the page.

## 5. Roles & authorization (RBAC)

| Action                                                 | Allowed                                                                                      | Explicitly denied                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| View `apps/homepage/status` page                       | Everyone (public/anonymous users and authenticated users)                                    | None                                                                                            |
| Poll service `/health` endpoints from status consumer  | Server-side status poller in homepage runtime                                                | Client-side browser direct polling flow is not relied on for source-of-truth status aggregation |
| Poll third-party monitor adapters from status consumer | Server-side status poller in homepage runtime using configured adapter credentials/endpoints | Direct client-side credentialed calls from browsers                                             |
| Produce `/health` response for a service               | Service backend runtime implementing its own endpoint                                        | Any caller attempting to mutate service state through `/health` (endpoint is read-only)         |
| Publish/update health contract library implementation  | Repository maintainers/contributors via reviewed PRs                                         | Runtime users; anonymous/public users cannot change contract behavior                           |

## 6. Out of scope / non-goals

- Incident-management workflow (paging/escalation policy tooling).
- Historical uptime analytics/SLA reporting beyond current-point status.
- Contract v2 breaking changes and migration process in this feature.

## 7. Critical-path test cases

1. Contract parser accepts valid payload and rejects invalid payloads (AC-1/AC-2).
2. `runChecks` maps thrown errors and timeout to normalized failures (AC-3/AC-4).
3. `summarizeStatus` matrix for down/degraded/ok (AC-5).
4. `/health` returns HTTP 200 + `no-store` + schema-valid body for a sanctioned service (AC-7).
5. Status consumer maps `unreachable`, `invalid_json`, and `invalid_contract` correctly (AC-9/AC-10/AC-11).
6. Status page renders supported valid response using body status and displays check/timestamp/contractVersion fields (AC-13).
7. Third-party monitor adapter maps provider response into shared status model and renders monitor type/source (AC-14).

## 8. Observability

- Events/metrics emitted via `@acme/logger`:
  - `homepage.status.poll_unreachable`
  - `homepage.status.poll_invalid_json`
  - `homepage.status.poll_invalid_contract`
  - `homepage.status.poll_unsupported_contract_version`
  - `homepage.status.poll_success`
  - `health.check.timeout`
  - `health.check.error_normalized`
