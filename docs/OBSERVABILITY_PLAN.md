# Observability Baseline Plan (F3-63)

> **STATUS (2026-08-12):** The error-tracking leg is now **OTel-first**:
> server-side exceptions flow through an OpenTelemetry logs pipeline in
> [`packages/observability`](../packages/observability/src/index.ts), with
> PostHog attached as an exporter _adapter_ (the only place `posthog-node` is
> imported). App code talks only to the OTel API — swapping trackers later
> means replacing one exporter. Client-side stays `posthog-js` directly
> (browser OTel is immature; `instrumentation-client.ts` masking rules
> unchanged). Traces/metrics (incl. DB APM) remain open — tracked as F3-88.
>
> **OWNER DECISION (2026-07-06, Declan):** Go **OTEL + PostHog**, drop Sentry.
> This supersedes the "keep Sentry" recommendation below (kept for the
> reasoning trail). Deciding facts: PostHog error tracking now ships a
> ~100k-errors/mo free tier (vs Sentry's 5k) plus masked session replay,
> product analytics (the browse-spec funnel), and OTLP-native Logs (GA
> 2/2026); tracing hedge: export traces to **Cloud Trace** until PostHog
> tracing exits alpha. The existing Sentry wiring is misconfigured anyway
> (unmasked replay/PII, shared DSN, 100% sampling), so swap cost ≈ fix
> cost. Migration: remove @sentry/nextjs from map+api, point
> @acme/logger's error bridge at PostHog, wire posthog-js with masking ON
> and per-product spend caps at $0.
>
> Scouting + planning deliverable for the AI-SDLC pilot: an OpenTelemetry
> baseline for the pilot apps (`map`, `api`, `admin`) and a PostHog-vs-Sentry
> free-tier evaluation. This is a **plan**, not an implementation — each phase
> below becomes its own ticket/PR. Companion docs: [`LOGGING.md`](LOGGING.md)
> (the logging layer this builds on) and
> [`AI_DEVELOPMENT_GUIDE.md`](AI_DEVELOPMENT_GUIDE.md) (guardrails, esp.
> multi-instance and PII rules).

## Table of Contents

- [1. Current state](#1-current-state)
- [2. Proposed baseline](#2-proposed-baseline)
- [3. PostHog vs Sentry (free tier, 2026)](#3-posthog-vs-sentry-free-tier-2026)
- [4. Phased rollout](#4-phased-rollout)
- [5. Human-owned callouts](#5-human-owned-callouts)

---

## 1. Current state

### Logging: solid, structured, GCP-native

- `@acme/logger` is a thin wrapper around **pino**
  (`packages/logger/src/index.ts`). Event-first helpers (`logInfo("map.x", ctx)`),
  `messageKey: "event"` so every line is keyed by a stable dot-namespaced
  identifier (`packages/logger/src/index.ts:70-77`).
- In production it emits JSON to stdout with pino levels mapped to Cloud
  Logging `severity` (`packages/logger/src/index.ts:14-21,80-86`) — so logs are
  already indexed and alertable in **Cloud Logging** per GCP project.
- A process-global **error reporter** hook (`setErrorReporter`,
  `packages/logger/src/index.ts:37-45`) fans `logError`/`logFatal` out to a
  registered sink. **At scout time** that sink was Sentry (PostHog absent);
  _this is historical context — the active sink is now **PostHog**, per the
  Owner Decision above, rewired in PR #54._
- Every app instantiates a service-named logger (`apps/map/src/lib/logging.ts`
  → `f3-map`; `packages/api/src/logger.ts` → `acme-api`; admin/auth/me have the
  same pattern).
- **No OTel hooks exist.** Logs carry no `trace_id`/`span_id`, so there is no
  log↔trace correlation today (nothing to correlate with — see next section).

### Error tracking: Sentry, already live in map + api (not admin)

> **Superseded — historical record.** This subsection describes what the
> scout found. Sentry has since been **removed and replaced by PostHog**
> (Owner Decision above; migration in PR #54). Do not read anything below
> as "we use Sentry".

- `map` and `api` have the full `@sentry/nextjs` (^10.62.0) wiring: Next
  `instrumentation.ts` with `register()` + `onRequestError`
  (`apps/map/src/instrumentation.ts`, `apps/api/src/instrumentation.ts`),
  server/edge configs, and client init with session replay
  (`apps/map/src/instrumentation-client.ts`).
- Both apps **share one Sentry DSN/project**
  (`apps/map/sentry.server.config.ts:14` and
  `apps/api/sentry.server.config.ts:15` are identical) — errors comingle,
  distinguished only by `environment` and tags.
- Server-side `tracesSampleRate: 1` (100 %) in both apps
  (`apps/map/sentry.server.config.ts:17`) — see cost callout in §5.
- Client replay is configured with `maskAllText: false, blockAllMedia: false`
  (`apps/map/src/instrumentation-client.ts`) — see PII callout in §5.
- **`admin` has none of this**: no `instrumentation.ts`, no Sentry dependency
  (`apps/admin/package.json`). Server errors reach Cloud Logging via pino only;
  client errors vanish.

### Tracing / metrics: zero

- No `@opentelemetry/*` packages are direct dependencies anywhere.
  `@opentelemetry/api@1.9.1` appears in `pnpm-lock.yaml` only as a peer of
  `next@16.2.9` and `@orpc/*@1.14.6` — meaning both **Next 16 and oRPC ship
  OTel-aware code paths we simply haven't turned on**.
- No `@vercel/otel`, no PostHog, no collector, no custom metrics.
- Next 16 supports `instrumentation.ts` natively (stable, no experimental
  flag), and both pilot Next apps already have the file — the OTel SDK has a
  ready-made home.

### Deploy target: Cloud Run, per-app GCP projects

- Each app deploys to its **own pair of GCP projects** via a shared reusable
  workflow (`.github/workflows/_deploy-cloudrun.yml`): `f3-map-app(-staging)`,
  `f3-api-app(-staging)`, `f3-admin-portal(-staging)`
  (`.github/workflows/deploy-map.yml:26-27`, `deploy-api.yml:26-27`,
  `deploy-admin.yml:26-27`).
- Per-PR **preview environments** live in the budget-capped sandbox project
  `f3-nation-dev` (`.github/workflows/preview-env.yml`, F3-56/F3-57; opt-in via
  the `preview` label, 7-day reaper).
- Consequence: Cloud Trace/Monitoring are **siloed per project**. A map→api
  request produces spans in two projects unless we centralize (see §2).

### The request-path spots the specs name

From the `/specs` observability sections (PR #551,
`specs/map-update-request-flow.md` §9 and `specs/map-browse-and-search.md` §9):

| Spec-named signal                                    | Where it lives today                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request.submitted` (tagged pending/auto-applied)    | `packages/api/src/router/request.ts:671` (`submitUpdateRequest`), `:551` (`submitDeleteRequest`); auto-approve branches at `:623`, `:784`         |
| `request.approved`                                   | `packages/api/src/router/request.ts:893` (`validateSubmissionByAdmin`), approval writes at `:1083`, `:1100`                                       |
| `request.rejected`                                   | `packages/api/src/router/request.ts:1019` (`rejectSubmission`)                                                                                    |
| `request.notification_failed`                        | `packages/api/src/services/map-request-notification.ts` (existing `api.map_request_notification.*` log events)                                    |
| `map.revalidate.triggered` / `map.revalidate.warmed` | `apps/map/src/app/api/revalidate/route.ts:31-85` (existing `map.revalidate.success/warm_failed/...` log events); API side: `api.map_revalidate.*` |
| `locationWorkout` latency                            | `packages/api/src/router/map/location.ts:193` (`GET /location-workout`)                                                                           |
| Map page-load timing (SSG hit vs dynamic render)     | Map route render path — no timing emitted today (relevant to F3-49 "slow map load")                                                               |
| Read-source attribution on map reads                 | Required by the public-reads migration (browse spec §10 decision 3) — every `map.*` read records its calling app/client                           |

**PII flag now, before instrumentation starts:** `updateRequests.submittedBy`
is a raw email (`packages/api/src/router/request.ts:88,580`). It flows through
the exact code paths we are about to instrument. See §5.

---

## 2. Proposed baseline

### Principle: build on what's already emitting

We already have (a) structured events in Cloud Logging and (b) error
capture in map + api (Sentry at scout time; **now PostHog** per the Owner
Decision, PR #54). The baseline adds the missing third leg — traces and
metrics — with the **smallest wiring that a volunteer team can operate**, and
upgrades the existing legs where they're misconfigured rather than replacing
them.

### Wiring per app

**`api` and `map` (Next 16 on Cloud Run):**

1. Add the OTel Node SDK, initialized from the existing
   `src/instrumentation.ts` `register()` hook (nodejs runtime branch only —
   same pattern the since-removed Sentry import used — now the PostHog
   registration from PR #54).
2. **~~Integration risk to resolve first~~ — OBSOLETE per Owner Decision:**
   Sentry is removed, so no coexistence spike is needed; run our own
   `NodeSDK` directly. _(Original analysis kept for the trail:)_
   `@sentry/nextjs` v10 is itself built on OpenTelemetry and installs its own
   TracerProvider. Running a second, independent `NodeSDK` conflicts. Two
   supported paths:
   - _(a)_ let Sentry own the OTel setup and attach a Cloud Trace–bound span
     processor/exporter to its provider; or
   - _(b)_ `skipOpenTelemetrySetup: true` in `Sentry.init` and run our own
     SDK, registering Sentry's `SentrySpanProcessor` + `SentryPropagator`.
     Path (b) keeps us vendor-neutral and is the recommended default; the
     spike confirms it against `@sentry/nextjs@10`.
3. **Exporter: direct OTLP export to Google's managed endpoint**
   (`telemetry.googleapis.com`) or the `@google-cloud/opentelemetry-cloud-trace-exporter`,
   authenticated via the Cloud Run service account. **No collector sidecar in
   phase 1** — a sidecar is the GCP-recommended pattern at scale, but it adds
   per-service cost and an ops surface a volunteer team doesn't need at this
   volume. Revisit if we outgrow direct export (verify current
   managed-OTLP-endpoint availability/pricing at implementation time).
4. **Auto-instrumentation:** HTTP server spans + `pg` client spans (bounded by
   sampling). oRPC 1.14 has native OTel support — enable it so every procedure
   gets a named span for free.
5. **Log↔trace correlation:** add a pino mixin in `@acme/logger` that reads the
   active OTel context and stamps `logging.googleapis.com/trace` +
   `logging.googleapis.com/spanId` onto every line. Cloud Logging then links
   logs to traces automatically. This is the single highest-leverage change —
   it upgrades every existing log event at once.
6. **Metrics — start with log-based metrics, not an SDK pipeline.** Because
   every counter-worthy moment already emits (or will emit) a stable pino
   `event`, phase 1 counters are **Cloud Logging log-based metrics** on those
   event names: zero code beyond emitting the log line, no in-process
   aggregation, nothing to flush on shutdown. Graduate to OTLP metrics only
   when we need histograms/exemplars beyond what log-based metrics give us.

**`admin`:** currently dark. Add `instrumentation.ts` + **PostHog** (per the
Owner Decision — this originally said Sentry) + the same OTel wiring, in
phase 3. Admin
is internal and low-traffic; error capture matters more than traces there.

**Cross-project traces:** map→api spans land in different GCP projects. For
phase 1–2, accept the silo (each team looks at its own project; the W3C
`traceparent` header still propagates, so trace IDs match across projects and
can be manually correlated). Centralizing into one observability project is a
deliberate later decision, not baseline.

### The first spans / metrics / events (spec-named where the specs name them)

| #   | Signal                                                                              | Type                                   | App / where                                      |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| 1   | `request.submitted` (attrs: `type=update\|delete`, `outcome=pending\|auto_applied`) | counter (log-based)                    | api — `router/request.ts` submit procedures      |
| 2   | `request.approved` (attr: `actor=admin\|auto`)                                      | counter (log-based)                    | api — `validateSubmissionByAdmin` + auto-approve |
| 3   | `request.rejected`                                                                  | counter (log-based)                    | api — `rejectSubmission`                         |
| 4   | `request.notification_failed`                                                       | counter (log-based)                    | api — `map-request-notification.ts`              |
| 5   | `map.revalidate.triggered` / `map.revalidate.warmed` (with warm duration)           | counter + duration attr (log-based)    | map — `app/api/revalidate/route.ts`              |
| 6   | `locationWorkout` latency                                                           | server span (histogram via trace data) | api — `router/map/location.ts:193`               |
| 7   | Map page-load timing, attr `render=ssg_hit\|dynamic`                                | server span on the map route render    | map (directly serves F3-49)                      |
| 8   | Read-source attribute (`client.app`) on every `map.*` read                          | span/log attribute                     | api — map router middleware                      |
| 9   | HTTP server spans (all routes)                                                      | auto-instrumented spans                | api + map                                        |
| 10  | `pg` query spans                                                                    | auto-instrumented spans (sampled)      | api                                              |

Search-to-selection funnel counts (browse spec §9) are deliberately **out of
scope for this plan** — they are client-side product analytics, not server
observability. Now that the PostHog migration itself has shipped (this PR),
funnel instrumentation is a separate, not-yet-scheduled follow-up; needs an
owner and milestone before it's picked up.

### Multi-instance guardrail

Cloud Run autoscales; per
[`AI_DEVELOPMENT_GUIDE.md`](AI_DEVELOPMENT_GUIDE.md) ("Assume multi-instance",
§Reliability): **no in-memory aggregation as a source of truth.** The design
above complies by construction — log-based metrics aggregate in Cloud Logging
(server-side), and OTel span export is per-instance push with server-side
aggregation in Cloud Trace. If we later adopt SDK metrics, they must be
delta-temporality push, never process-local counters read back for decisions.

### Preview environments

**Traces/logs ON, error tracker (now PostHog, was Sentry) OFF by default,
alerts OFF in previews.**

- Previews (sandbox project `f3-nation-dev`) are where AI-SDLC verification
  happens — traces there are cheap (volume is tiny, and Cloud Trace's free
  ingestion allotment covers it; verify current free-tier numbers) and
  directly useful for agent debugging. Logs already flow.
- The error tracker stays lightweight in previews to avoid noise-flooding
  free-tier quota. _(Written for Sentry; the principle carries to **PostHog**,
  whose actual preview behavior, per PR #54, is: with no key configured nothing
  is captured; with the preview server key set, server-side error capture is
  enabled; session recording stays disabled. The referenced
  `sentry.server.config.ts` files no longer exist.)_
- No alerting from preview or staging projects.

---

## 3. PostHog vs Sentry (free tier, 2026)

> Pricing/limits below are from training knowledge as of early 2026 —
> **verify current pricing before committing** to either tier as a load-bearing
> constraint.

### What each is actually for

| Dimension        | Sentry                                                                                                                                             | PostHog                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core job         | **Error tracking** + performance tracing, release health, session replay (error-focused)                                                           | **Product analytics** (events, funnels, retention) + session replay, feature flags, A/B tests; error tracking added ~2024, younger than Sentry's              |
| Free tier        | 1 user; ~5k errors/mo; span-based performance quota; small replay allowance (~50/mo). Single-user limit is the pinch point for a team. **Verify.** | Very generous usage-based free tier: ~1M analytics events/mo, ~5k replays/mo, ~100k exceptions/mo, feature-flag requests; unlimited team members. **Verify.** |
| Self-host        | Open-source self-hosted exists but is heavy (large Docker Compose, real ops burden) — not realistic for volunteers                                 | Open-source "hobby" Docker deploy exists; explicitly not recommended by PostHog beyond small scale — also not a volunteer fit                                 |
| Sunk integration | **Already wired** into map + api, including the pino error-reporter bridge                                                                         | Nothing in the repo today (`pnpm-lock.yaml` has no posthog entries)                                                                                           |

### Assessment for F3 (volunteer-run nonprofit, public repo)

- **Error visibility is a today-problem and Sentry already solves it.** The
  integration exists, the logger bridge exists, and the marginal cost of
  keeping it is zero. Replacing it with PostHog's younger error tracking would
  be motion without progress. Note: if the paid-team seat question ever bites
  (Sentry free = 1 user), Sentry's nonprofit/open-source sponsorship programs
  are the first thing to check — **verify eligibility** before considering a
  migration.
- **Funnels are a next-quarter-problem.** The only spec-named product-analytics
  need is the search-to-selection funnel (browse spec §9). That is real but not
  urgent, and PostHog's free tier would absorb F3's volume trivially when it
  becomes urgent.
- **Two tools is fine because they don't overlap here**: Sentry = "the app
  broke", PostHog = "how do humans use the map". The trap to avoid is turning
  on both tools' overlapping features (both do replay, both do
  errors, both do tracing) and paying the ops/PII cost twice.

### Recommendation

**~~Keep Sentry (fix its config), defer PostHog~~ — SUPERSEDED by the Owner
Decision at the top of this doc: OTEL + PostHog, Sentry removed.** The
original recommendation is preserved below for the reasoning trail only:

1. **Sentry stays** as the error-tracking layer for all three pilot apps —
   including adding it to `admin`, which currently has nothing. Fix the
   misconfigurations while we're in there: split the shared map/api DSN into
   per-app projects, drop server `tracesSampleRate` from 1.0 (OTel/Cloud Trace
   is taking over tracing), and fix replay masking (§5).
2. **PostHog: not yet.** Adopt it (cloud free tier, map app only, analytics +
   funnel features only — no replay, no error tracking) when the first real
   funnel question is asked — concretely, when the search-to-selection funnel
   from the browse spec is prioritized. Until then, coarse usage counts fall
   out of the OTel/log-based metrics for free.
3. **Self-hosting neither.** Both self-host paths are an ops burden a
   volunteer team should not carry.

---

## 4. Phased rollout

### Phase 1 — `api`: traces + error capture, proven in sandbox previews

- ~~Sentry/OTel coexistence spike~~ _(obsolete — Sentry removed, PR #54; no
  coexistence needed)_, then OTel SDK in
  `apps/api/src/instrumentation.ts` with direct Cloud Trace export.
- oRPC + HTTP + `pg` auto-instrumentation; pino trace-correlation mixin in
  `@acme/logger`.
- Emit the four `request.*` events (log lines) and define their log-based
  metrics in the staging/prod projects.
- Verify end-to-end in a labeled preview env (`f3-nation-dev`): submit an
  update request in the preview, see the trace + correlated logs.
- ~~Sentry: split api onto its own DSN~~ _(obsolete — PostHog replaced
  Sentry, PR #54; instead confirm PostHog's preview posture: server capture
  on, recording off)_.
- **Effort: ~3–4 focused days** (roughly half of it the spike + IAM/exporter
  plumbing, which phases 2–3 then reuse for free).

### Phase 2 — `map`: the user-facing signals

- Same SDK wiring via the existing `apps/map/src/instrumentation.ts`.
- `map.revalidate.triggered` / `map.revalidate.warmed` events + metrics on
  `app/api/revalidate/route.ts`.
- Map route render span with `render=ssg_hit|dynamic` attribute (F3-49
  page-load timing), `locationWorkout` latency span (api-side, surfaced here),
  and the read-source attribute on map reads (prerequisite for the
  public-reads migration).
- ~~Sentry: own DSN, drop `tracesSampleRate`, fix replay masking~~ _(done
  differently: replay masked upstream in F3-Nation#593, then Sentry removed
  entirely for PostHog in PR #54)_.
- **Effort: ~2–3 focused days.**

### Phase 3 — alerts (+ admin baseline)

- Cloud Monitoring alert policies on the phase 1–2 metrics: review backlog
  (`request.submitted` pending vs `approved`/`rejected` rate),
  `request.notification_failed` > 0, revalidate failure rate,
  `locationWorkout` latency threshold. Prod projects only.
- Error-tracker alert rules per app (new-issue + regression) — **in
  PostHog** (originally written for Sentry) — routed to the team's Slack.
- Bring `admin` up to baseline: `instrumentation.ts`, **PostHog** (not
  Sentry — Owner Decision), OTel wiring (reusing the phase 1 module).
- Tune sampling based on observed phase 1–2 volume (see §5).
- **Effort: ~2 focused days.**

---

## 5. Human-owned callouts

Decisions below need a human owner and sign-off — agents implementing this
plan must not resolve them unilaterally.

1. **PII in traces — emails in update requests.** `submittedBy` is a raw email
   (`packages/api/src/router/request.ts:88,580`) flowing through the exact
   procedures we are instrumenting. Rule: **span attributes, metric labels,
   and log ctx carry request IDs, never emails** — same as the existing
   "never log secrets or PII" rule ([`LOGGING.md`](LOGGING.md) golden rule;
   [`AI_DEVELOPMENT_GUIDE.md`](AI_DEVELOPMENT_GUIDE.md) rule 4). This extends
   to thrown `Error` messages/stacks too — `err` is serialized and forwarded
   to PostHog exception tracking the same as `ctx` is, so a PII-carrying error
   message reaches it just as directly as a `ctx` field would. Needs an
   explicit review pass on every new attribute (and every new thrown error)
   in phases 1–2.
2. **Session replay is currently unmasked.** `maskAllText: false,
blockAllMedia: false` in `apps/map/src/instrumentation-client.ts` means
   replays can capture whatever users type — including the update-request form
   (names, emails). A human should decide: mask the form fields, or disable
   replay. Do this **before** any PostHog replay conversation.
   _(**RESOLVED**: masked upstream in F3-Nation#593; Sentry replay then
   removed entirely in PR #54 — PostHog session recording ships off by
   default; when enabled, `instrumentation-client.ts` sets
   `session_recording: { maskAllInputs: true }`, which masks `<input>` element
   values — not arbitrary on-page text. Plain DOM text rendered outside a
   form input (e.g. a name shown as text rather than typed) is not masked
   under the current config.)_
3. **Cost exposure / quota cliffs.** _(Sentry sampling point moot since
   PR #54 removed it; the Cloud Trace allotment caveat stands.)_ Server
   `tracesSampleRate: 1` in Sentry
   (`apps/map/sentry.server.config.ts:17`) sends 100 % of transactions against
   a free-tier quota; Cloud Trace/Monitoring are free only up to monthly
   allotments (**verify current numbers**). A human owns the budget line and
   the decision to add billing alerts in each GCP project before phase 1
   ships.
4. **Sampling policy.** Phase 1 starts with parent-based sampling at a low
   fixed rate (suggest 10 % for HTTP spans, 100 % for the named request-flow
   spans, which are low-volume). The actual numbers are a human call after
   seeing phase 1 volume — encode them in env vars, not code.
5. ~~**Shared Sentry DSN split.**~~ _(**HISTORICAL / CLOSED**: moot — Sentry
   was removed entirely in PR #54, replaced by PostHog error tracking. No DSN
   split decision remains to make.)_
6. **Multi-instance rule is a review gate.** Any PR in this workstream that
   introduces an in-process counter, queue, or cache used as a source of truth
   is an automatic reject
   ([`AI_DEVELOPMENT_GUIDE.md`](AI_DEVELOPMENT_GUIDE.md) rule 5).
