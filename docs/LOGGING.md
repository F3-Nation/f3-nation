# Logging

> A human-friendly guide to how this monorepo does logging. For the full API
> reference, see [`packages/logger/README.md`](../packages/logger/README.md).
> For the short, agent-facing rules, see [`AGENTS.md` § Logging](../AGENTS.md).

Every app and package logs through one shared package — **`@acme/logger`**, a
thin wrapper around [pino](https://getpino.io). This page explains what that
means, why we do it, and how to use it day to day.

## Table of Contents

- [Why we log this way](#why-we-log-this-way)
- [The mental model: `event`, `ctx`, `err`](#the-mental-model-event-ctx-err)
- [How to write a log](#how-to-write-a-log)
- [Naming the `event`](#naming-the-event)
- [Turning the volume up or down (`LOG_LEVEL`)](#turning-the-volume-up-or-down-log_level)
- [What logs look like (dev vs. prod)](#what-logs-look-like-dev-vs-prod)
- [Errors and PostHog](#errors-and-posthog)
- [The golden rule: never log secrets or PII](#the-golden-rule-never-log-secrets-or-pii)
- [See also](#see-also)

## Why we log this way

Plain `console.log("user " + id + " failed to register")` is fine for a script
on your laptop and miserable in production. Every line is a slightly different
sentence, so you can't reliably search, group, or count them, and the
interesting values are glued into prose instead of living in queryable fields.

We replaced all of that with **structured logging via pino**. Three things fall
out of that choice:

- **Every line is JSON** in production — a bag of fields, not a sentence. Google
  Cloud Logging indexes those fields, so you can filter and build alerts on them.
- **Every line is keyed by a stable `event` identifier** (our one house
  convention on top of pino). Because `me.avatar.upload_failed` is always
  spelled exactly the same way, you can ask "how many avatar uploads failed in
  the last hour?" and actually get an answer. A free-text message can't do that.
- **pino is fast.** It does the minimum work on the hot path and serializes
  cheaply, so logging liberally doesn't cost you much.

The payoff: logs become _data_ you can query and alert on, instead of a wall of
text you scroll through after something has already gone wrong.

## The mental model: `event`, `ctx`, `err`

Every log call is the same shape — a fixed label, plus the variable data, kept
separate on purpose:

```ts
logError("auth.register.f3_api_error", { userId }, err);
//        └─ event ───────────────┘   └─ ctx ──┘  └ err
```

- **`event`** — _what happened_, as a fixed, dot-namespaced string literal. This
  is the stable key you group and alert on. It never contains variable data.
- **`ctx`** — _the details of this one occurrence_, as a flat object
  (`{ userId, orgId, durationMs }`). This is where the variable data goes.
- **`err`** — _the thrown value_, on `logError` / `logFatal` only. It's
  serialized to name + message + stack, and forwarded to PostHog when a reporter
  is registered (see [Errors and PostHog](#errors-and-posthog)).

Keeping the label fixed and the data in `ctx` is the whole trick: it's what lets
you count "this kind of thing" while still keeping the specifics of each one.

## How to write a log

Each app/package has a one-line `lib/logging` module that names the service once
and re-exports the bound helpers (e.g.
[`apps/api/src/lib/logging.ts`](../apps/api/src/lib/logging.ts)):

```ts
import { createLogger } from "@acme/logger";

export const { logInfo, logWarn, logError, logger } = createLogger("f3-api");
```

> Don't call `createLogger` more than once per service — import your app's
> existing `lib/logging` module instead.

Then log against an `event`, never a sentence:

```ts
import { logError, logInfo } from "~/lib/logging";

logInfo("api.request.received", { method, path });

try {
  await callF3Api();
} catch (err) {
  logError("auth.register.f3_api_error", { userId }, err);
}
```

There's **one helper per level** — `logTrace`, `logDebug`, `logInfo`, `logWarn`,
`logError`, `logFatal`. They all take the `event` **first**; the two failure
levels (`logError`, `logFatal`) also accept a trailing `err`. Prefer these
helpers for everything, including debug logging.

> [!TIP]
> Reach for the raw `logger` (from your `lib/logging` module) only for
> request-scoped child loggers: `logger.child({ requestId })`. Pino's native
> methods take the context object **first** — the opposite order from our
> helpers — so don't mix the two styles by habit. The
> [package README](../packages/logger/README.md#helpers-vs-the-raw-logger) has
> the details.

## Naming the `event`

The `event` identifier follows a simple shape:

**`<area>.<feature>.<outcome>`** — lowercase, `snake_case` within a segment, `.`
between segments, usually three segments.

- `<area>` — the service or domain (`api`, `auth`, `me`, `map`).
- `<feature>` — the operation (`register`, `avatar`, `rpc`).
- `<outcome>` — what happened (`received`, `upload_failed`, `handler_error`).

| `event`                      | reads as                                |
| ---------------------------- | --------------------------------------- |
| `api.rpc.handler_error`      | an RPC handler in the API errored       |
| `auth.register.f3_api_error` | registration hit an F3 API error        |
| `me.avatar.upload_failed`    | an avatar upload in the `me` app failed |

> [!IMPORTANT]
> **Keep `event` a fixed string literal.** Never interpolate variable data into
> it — `` `user.${id}.failed` `` is wrong. Every unique string becomes its own
> bucket, so interpolation explodes the cardinality and makes the field useless
> for grouping. Variable data belongs in `ctx`.

## Turning the volume up or down (`LOG_LEVEL`)

Logging verbosity is controlled by the **`LOG_LEVEL`** environment variable.
Anything _below_ the active level is dropped, so a higher level = quieter logs.

| `LOG_LEVEL` | Shows                                             |
| ----------- | ------------------------------------------------- |
| `trace`     | everything, including very fine-grained tracing   |
| `debug`     | developer diagnostics and everything above        |
| `info`      | normal lifecycle events and above _(the default)_ |
| `warn`      | warnings and above                                |
| `error`     | errors and fatals only                            |
| `fatal`     | fatals only                                       |

The default when `LOG_LEVEL` is unset is **`info`**, which is why `logDebug`
lines don't show up out of the box. To **see debug output locally**, set it to
`debug` (or `trace` for the firehose):

```bash
LOG_LEVEL=debug
```

The checked-in examples already wire this up for you:

- Local **`.env.example`** files default to `LOG_LEVEL=debug` — so a fresh local
  setup shows `logDebug` output.
- **`.env.cloud-run.example`** files default to `LOG_LEVEL=info` — production
  stays quiet, and you raise it deliberately when you need to dig in.

The accepted values are validated in
[`packages/env/src/index.ts`](../packages/env/src/index.ts), so a typo fails
fast at startup rather than silently logging at the wrong level.

## What logs look like (dev vs. prod)

`@acme/logger` adapts its output to the environment for you:

- **Development** — pretty-printed, colorized output via `pino-pretty`, easy to
  read in your terminal. (`pino-pretty` is loaded lazily, so it never ships to
  production.)
- **Production** (`NODE_ENV=production`) — structured JSON to stdout, with
  pino's numeric `level` mapped to a GCP `severity` string (`info` → `INFO`,
  `error` → `ERROR`, …) so Google Cloud Logging colors and filters them
  correctly.

You don't configure any of this per-call — write the same `log*` call
everywhere and the package picks the right format.

## Errors and PostHog

`logError` and `logFatal` write to **stdout** (pino), not `console.error` — an
error tracker watching the console would never see our error logs.

So apps register a process-global **error reporter** at startup via
[`@acme/observability`](../packages/observability/src/index.ts)'s
`registerLoggerErrorReporter()` (see each app's `instrumentation.ts`).
Whenever you call `logError`/`logFatal`, the helper fans the event out to that
reporter, which forwards it through the OpenTelemetry exception pipeline to
the configured error tracker (PostHog today, behind an exporter adapter) —
with an `Error` it's captured as-is, and without one (a config/validation
failure) a synthetic error named after the `event` is captured instead. The
`event` name and `ctx` ride along as event properties for triage.

The upshot for you: **just call `logError`** with the thrown value as the third
argument. You don't call PostHog (or OTel) directly — error logging reaches
the tracker on a best-effort basis (the reporter call is synchronous/
fire-and-forget, and a tracker outage is logged, not thrown).

## The golden rule: never log secrets or PII

Structured logs land in stdout, and error-level logs (`logError`/`logFatal`)
also reach PostHog error tracking via the reporter bridge — so treat them as if
they're permanent and widely readable. **Never** put secrets, tokens, full
request bodies, or personal data (emails, phone numbers, emergency contacts)
into `event` or `ctx` — **or into a thrown `Error`'s message**. `err` is
serialized (name, message, stack) and forwarded just like `ctx`; the logger
has no way to tell a PII-carrying error message from a safe one, so the same
discipline applies at the point you construct or rethrow an error as applies
to `ctx`.

Log **identifiers, not personal data** — `{ userId }`, not `{ email }`;
`Object.keys(updateSet)` (which fields changed), not the values themselves. When
in doubt, log a stable id and look the rest up out-of-band.

See
[`docs/AI_DEVELOPMENT_GUIDE.md` § Secrets & sensitive data](AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data)
for the full policy.

## See also

- [`packages/logger/README.md`](../packages/logger/README.md) — the complete API
  reference (`createLogger`, `AppLogger`, `setErrorReporter`, `LogContext`).
- [`AGENTS.md` § Logging](../AGENTS.md) — the condensed rules for AI agents and
  quick lookups.
- [`docs/AI_DEVELOPMENT_GUIDE.md`](AI_DEVELOPMENT_GUIDE.md) — secure-by-default
  patterns, including the secrets/PII policy.
