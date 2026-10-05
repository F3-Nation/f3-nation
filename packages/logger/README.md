# @acme/logger

Shared structured logging for every app and package in the monorepo. A thin
wrapper around [pino](https://getpino.io) that fixes one house convention: every
log line is keyed by a stable, dot-namespaced **`event`** identifier rather than
a free-text message.

## Table of Contents

- [Quick Start](#quick-start)
- [The `event` naming convention](#the-event-naming-convention)
- [`ctx` and `err`: where the variable data goes](#ctx-and-err-where-the-variable-data-goes)
- [Log levels](#log-levels)
- [Helpers vs. the raw `logger`](#helpers-vs-the-raw-logger)
- [Error reporting](#error-reporting)
- [Environment behavior](#environment-behavior)
- [API Reference](#api-reference)

---

## Quick Start

Each app/package owns a one-line module that names the service once and
re-exports the bound functions (e.g. [`apps/api/src/lib/logging.ts`](../../apps/api/src/lib/logging.ts)):

```ts
import { createLogger } from "@acme/logger";

export const { logInfo, logWarn, logError, logger } = createLogger("f3-api");
```

Then log against an `event` identifier, never a sentence:

```ts
import { logError, logInfo } from "~/lib/logging";

logInfo("api.request.received", { method, path });

try {
  await callF3Api();
} catch (err) {
  logError("auth.register.f3_api_error", { userId }, err);
}
```

Do **not** call `createLogger` more than once per service — import the existing
`logging` module instead.

## The `event` naming convention

The first argument to every `log*` helper is an **event identifier**, not a
human message. It becomes pino's message key (the logger
sets `messageKey: "event"`), so every line carries `"event": "..."` — a field
you group, count, and alert on in Google Cloud Logging.

Format: **`<area>.<feature>.<outcome>`**

- Lowercase; `snake_case` within a segment; `.` between segments.
- Usually three segments. `<area>` is the service or domain (`api`, `auth`,
  `me`, `map`), `<feature>` the operation (`register`, `avatar`, `rpc`),
  `<outcome>` what happened (`received`, `upload_failed`, `handler_error`).
- **Keep it a fixed string literal.** Never interpolate variable data into it
  (`` `user.${id}.failed` `` is wrong) — that explodes cardinality and makes the
  field useless for grouping. Variable data goes in `ctx`.

Examples from the codebase:

| `event`                      | area | feature  | outcome       |
| ---------------------------- | ---- | -------- | ------------- |
| `api.rpc.handler_error`      | api  | rpc      | handler_error |
| `api.openapi.handler_error`  | api  | openapi  | handler_error |
| `auth.register.f3_api_error` | auth | register | f3_api_error  |
| `me.avatar.upload_failed`    | me   | avatar   | upload_failed |
| `me.users.fetch_failed`      | me   | users    | fetch_failed  |

## `ctx` and `err`: where the variable data goes

- **`ctx`** (second arg) — a flat object of structured key/values for this
  occurrence (`{ userId, orgId, durationMs }`). Merged into the log line.
- **`err`** (third arg, `logError` / `logFatal` only) — the actual thrown value. It is
  serialized via pino's `err` serializer (name, message, stack) and, when an
  error reporter is registered (via `setErrorReporter`), forwarded to it as
  the captured exception. This package doesn't require or assume any
  particular tracker — every current app registers @acme/observability's
  OTel-based reporter. See
  [Error reporting](#error-reporting) below.

> [!IMPORTANT]
> Never put secrets or PII (emails, tokens, full request bodies) in `event`,
> `ctx`, **or a thrown `Error`'s message** — `err` is serialized and forwarded
> just like `ctx`. Log identifiers, not personal data. See
> [Secrets & sensitive data](../../docs/AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data).

## Log levels

There is one helper per pino level. All take the `event` identifier first; the
two failure levels also accept a trailing `err`.

| Function   | Level   | Use for                                                          |
| ---------- | ------- | ---------------------------------------------------------------- |
| `logTrace` | `trace` | Very fine-grained tracing; off unless `LOG_LEVEL=trace`.         |
| `logDebug` | `debug` | Developer diagnostics; off in prod (default `info`), on locally. |
| `logInfo`  | `info`  | Normal lifecycle events worth keeping.                           |
| `logWarn`  | `warn`  | Recoverable / unexpected-but-handled conditions.                 |
| `logError` | `error` | Failures. Also fans out to the error reporter if registered.     |
| `logFatal` | `fatal` | Unrecoverable failures. Also fans out to the error reporter.     |

The active level is `LOG_LEVEL` (env) or `info` by default — anything below it is
dropped. Local `.env` defaults to `debug`; Cloud Run to `info`.

## Helpers vs. the raw `logger`

**Default to the `log*` helpers for all event logging**, including debug/trace.
They take the `event` identifier **first** (`logDebug("api.user.update_set", { updateSet })`).

Reach for the raw `logger` only when a helper can't express what you need — in
practice, **request-scoped child loggers**. Note that pino's native methods take
the context object **first** (the opposite order), so don't mix the styles by
habit:

```ts
import { logger } from "~/lib/logging";

const reqLog = logger.child({ requestId }); // helpers can't carry per-request bindings
reqLog.info({ path }, "api.request.received"); // pino order: (ctx, event)
```

> [!WARNING]
> Calling the raw instance with the helper's argument order —
> `logger.debug("api.user.update_set", { updateSet })` — makes pino treat the
> string as the message and **silently drop `{ updateSet }`** as a printf arg.
> If you're not creating a child logger, use `logDebug` instead.

## Error reporting

`logError` writes to stdout (pino), not `console.error`, so a console-watching
error tracker would miss it. Apps register a process-global reporter at
startup so error logs also reach the error tracker (PostHog today, behind
@acme/observability's OTel pipeline), on a best-effort basis — see
[`packages/observability/src/index.ts`](../observability/src/index.ts):

```ts
import { setErrorReporter } from "@acme/logger";

setErrorReporter((event, ctx, err) => {
  // ctx spread BEFORE event: a ctx key named "event" must not be able to
  // overwrite the canonical event identifier used for triage.
  void captureException(err ?? new Error(event), { ...ctx, event });
});
```

The reporter receives the full payload, so error logs that carry no `Error`
(config/validation failures) are still reported as a synthetic error named
after the `event` — with the `event` and `ctx` attached as properties for
triage. `logError`/`logFatal` call the reporter synchronously and don't await
it, and `captureException` swallows its own transport failures (logging
them, never throwing) — so "reaches the tracker" here means "an attempt was
made and logged if it failed," not a delivery guarantee.

## Environment behavior

- **Production** (`NODE_ENV=production`): structured JSON to stdout, with pino's
  numeric `level` mapped to a GCP `severity` string (`info`→`INFO`,
  `error`→`ERROR`, …) for Google Cloud Logging.
- **Development**: pretty-printed, colorized output via `pino-pretty` (lazily
  required so it never loads in production).

## API Reference

```ts
createLogger(service: string, options?: { level?: string }): AppLogger
```

Returns an `AppLogger`. `service` is stamped on every line as `base.service`.

```ts
interface AppLogger {
  logger: Logger; // raw pino instance — for `.child({ ... })`
  logTrace: (event: string, ctx?: LogContext) => void;
  logDebug: (event: string, ctx?: LogContext) => void;
  logInfo: (event: string, ctx?: LogContext) => void;
  logWarn: (event: string, ctx?: LogContext) => void;
  logError: (event: string, ctx?: LogContext, err?: unknown) => void;
  logFatal: (event: string, ctx?: LogContext, err?: unknown) => void;
}

setErrorReporter(fn: (event, ctx, err?) => void): void
```

`LogContext` is `Record<string, unknown>`.
