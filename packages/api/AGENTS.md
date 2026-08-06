## Error Handling

Full rationale, the code-selection table, and the `catch`-block pattern:
[`docs/AI_DEVELOPMENT_GUIDE.md`](../../docs/AI_DEVELOPMENT_GUIDE.md#error-handling).

- Throw `new ORPCError(code, { message })`, never a raw `Error` — oRPC masks
  untyped throws as an opaque 500 and drops the message. Enforced by ESLint over
  `src/router` and `src/lib` (see `eslint.config.js`); the router delegates its
  apply path to `src/lib`, so a raw throw there is masked the same way.
- 4xx for client errors, `INTERNAL_SERVER_ERROR`/`BAD_GATEWAY` only for genuinely
  unexpected server or upstream failures.
- **`UNAUTHORIZED` covers both unauthenticated and insufficient-role** in this
  codebase; `FORBIDDEN` is used at only three sites. Use `UNAUTHORIZED` for
  permission checks, and do not file existing ones as miscoded — it is not a
  finding.
- **Never bare-rethrow in a `catch`.** No lint rule can catch `throw error`.
  Guard on `error instanceof ORPCError`, `logError` the original, then wrap in a
  generic `INTERNAL_SERVER_ERROR`.
- A missing row is only `NOT_FOUND` if the caller could have caused it. If the
  lookup key is boundary-constrained (a `z.enum`, a literal, session-derived), a
  miss means our data is wrong — that is `INTERNAL_SERVER_ERROR`.
