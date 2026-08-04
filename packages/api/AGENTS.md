## Error Handling

### Summary

- Router handlers in `packages/api/src/router` must throw
  `new ORPCError(code, { message })`, never a raw `Error`. oRPC masks any
  non-`ORPCError` throw as an opaque 500 `INTERNAL_SERVER_ERROR` and drops the
  message, so clients can't distinguish a bad request from a server fault.
  Use `BAD_REQUEST`/`UNAUTHORIZED`/`NOT_FOUND`/etc. for client errors (4xx) and
  reserve `INTERNAL_SERVER_ERROR`/`BAD_GATEWAY` for genuinely unexpected
  server or upstream failures. Note this codebase uses `UNAUTHORIZED` for both
  unauthenticated and insufficient-role failures rather than splitting out
  `FORBIDDEN`. This is enforced by
  an ESLint `no-restricted-syntax` rule scoped to `packages/api/src/router` and
  `packages/api/src/lib` — the router delegates its apply path to the latter, so
  a raw throw there is masked the same way (see
  `packages/api/eslint.config.js`); see
  [`docs/AI_DEVELOPMENT_GUIDE.md`](docs/AI_DEVELOPMENT_GUIDE.md#error-handling)
  for the full rationale and code-selection guidance.
- **Never bare-rethrow in a router `catch`.** `throw error` is an Identifier, so
  the lint rule cannot see whether the value is an `ORPCError` — and a raw DB or
  driver fault gets masked as an opaque 500 with its cause lost. Guard, log, then
  wrap:

  ```ts
  } catch (error) {
    if (error instanceof ORPCError) throw error; // already typed and client-safe
    logError("api.<area>.<outcome>", { ...safeCtx }, error);
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Generic message" });
  }
  ```

  Keep the wrapped message generic — never interpolate the caught error into it,
  and keep PII out of the log context.

### Reasioning

Why it matters: oRPC only preserves the code, status, and message of a typed
[`ORPCError`](https://orpc.unnoq.com/docs/error-handling). Any other thrown
value (including a plain `throw new Error("...")`) is masked as an opaque 500
`INTERNAL_SERVER_ERROR`, and the original message is dropped before it reaches
the client. Concretely, this means:

- **Clients can't distinguish their own mistake from a server bug.** A
  missing required field and a database outage both come back as the same
  generic 500, so retry logic can't tell which errors are worth retrying.
- **The HTTP status code is wrong.** A validation failure should be a 4xx,
  not a 500 — 5xx rates are typically used as a server-health signal, and
  masked client errors pollute that signal with noise that isn't actionable.

```ts
// WRONG — becomes an opaque 500, message is dropped.
if (!input.regionId) throw new Error("Region is required");

// Client error — pick the code that matches why the request failed.
if (!input.regionId) {
  throw new ORPCError("BAD_REQUEST", { message: "Region is required" });
}
```

Pick the code by what actually went wrong, not by what's convenient:

| Situation                                             | Code                    | Status |
| ----------------------------------------------------- | ----------------------- | ------ |
| Missing/invalid input                                 | `BAD_REQUEST`           | 400    |
| Not signed in, or signed in without the required role | `UNAUTHORIZED`          | 401    |
| A referenced resource doesn't exist                   | `NOT_FOUND`             | 404    |
| An upstream/external call failed                      | `BAD_GATEWAY`           | 502    |
| Truly unexpected server state (should be unreachable) | `INTERNAL_SERVER_ERROR` | 500    |

**On `UNAUTHORIZED` vs `FORBIDDEN`.** Strict HTTP semantics reserve 401 for
"unauthenticated" and 403 for "authenticated but not permitted". This codebase
does not split them that way: `UNAUTHORIZED` covers both. Every procedure
wrapper in [`packages/api/src/shared.ts`](../packages/api/src/shared.ts)
(`protectedProcedure`, `editorProcedure`, `adminProcedure`,
`nationAdminProcedure`, `revalidateAuthProcedure`) throws `UNAUTHORIZED` on a
role failure, and handler-level permission checks match — e.g. the region and
approval gates in `packages/api/src/router/request.ts`. Raw `UNAUTHORIZED`
throws outnumber `FORBIDDEN` by more than an order of magnitude.

Follow that convention in new code so clients need only one branch for "you
can't do this". **Matching the surrounding code here is not a finding** — do not
file or "fix" an `UNAUTHORIZED` permission check as a miscoded error. If the
split is ever worth adopting, it is a deliberate repo-wide migration (every
wrapper, plus the clients that branch on the code), not a per-PR cleanup.

A lint failure from the enforcing rule means the error needs a real
`ORPCError` code — not a suppression.
