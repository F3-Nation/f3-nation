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
- [Request-scoped child loggers](#request-scoped-child-loggers)
- [Sentry / error reporting](#sentry--error-reporting)
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

The first argument to `logInfo` / `logWarn` / `logError` is an **event
identifier**, not a human message. It becomes pino's message key (the logger
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
- **`err`** (third arg, `logError` only) — the actual thrown value. It is
  serialized via pino's `err` serializer (name, message, stack) and, when a
  Sentry reporter is registered, sent as the captured exception.

> [!IMPORTANT]
> Never put secrets or PII (emails, tokens, full request bodies) in `event` or
> `ctx`. Log identifiers, not personal data. See
> [Secrets & sensitive data](../../docs/AI_DEVELOPMENT_GUIDE.md#secrets--sensitive-data).

## Log levels

| Function   | Level   | Use for                                                       |
| ---------- | ------- | ------------------------------------------------------------- |
| `logInfo`  | `info`  | Normal lifecycle events worth keeping.                        |
| `logWarn`  | `warn`  | Recoverable / unexpected-but-handled conditions.              |
| `logError` | `error` | Failures. Also fans out to the Sentry reporter if registered. |

The level is `LOG_LEVEL` (env) or `info` by default.

## Request-scoped child loggers

For correlated logs within one request, branch the raw pino instance:

```ts
import { logger } from "~/lib/logging";

const reqLog = logger.child({ requestId });
reqLog.info({ path }, "api.request.received");
```

## Sentry / error reporting

`logError` writes to stdout (pino), not `console.error`, so Sentry's
`captureConsoleIntegration` would miss it. Apps that use Sentry register a
process-global reporter at startup so error logs still reach Sentry — see
[`apps/api/sentry.server.config.ts`](../../apps/api/sentry.server.config.ts):

```ts
import { setErrorReporter } from "@acme/logger";

setErrorReporter((event, ctx, err) => {
  if (err !== undefined) {
    Sentry.captureException(err, { tags: { event }, extra: ctx });
  } else {
    Sentry.captureMessage(event, { level: "error", extra: ctx });
  }
});
```

The reporter receives the full payload, so error logs that carry no `Error`
(config/validation failures) are still reported — preserving the `event` as a
Sentry tag for triage.

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

Returns `{ logger, logInfo, logWarn, logError }`. `service` is stamped on every
line as `base.service`.

```ts
interface AppLogger {
  logger: Logger; // raw pino instance — for `.child({ ... })`
  logInfo: (event: string, ctx?: LogContext) => void;
  logWarn: (event: string, ctx?: LogContext) => void;
  logError: (event: string, ctx?: LogContext, err?: unknown) => void;
}

setErrorReporter(fn: (event, ctx, err?) => void): void
```

`LogContext` is `Record<string, unknown>`.
