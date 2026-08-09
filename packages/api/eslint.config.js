import baseConfig from "@acme/eslint-config/base";

const ORPC_ERROR_MESSAGE =
  "Throw `new ORPCError(code, { message })` instead of a raw Error — oRPC masks non-ORPCError throws as an opaque 500 and drops the message. Use BAD_REQUEST for invalid/missing input, UNAUTHORIZED for permission checks (this codebase uses it for both unauthenticated and insufficient-role — see docs/AI_DEVELOPMENT_GUIDE.md#error-handling), NOT_FOUND for a missing referenced resource, and INTERNAL_SERVER_ERROR only for truly unexpected server state.";

export default [
  ...baseConfig,
  { ignores: ["vitest.config.ts", "vitest.globalSetup.ts", "__tests__", "coverage"] },
  {
    // oRPC masks any thrown value that isn't an ORPCError as an opaque 500
    // INTERNAL_SERVER_ERROR — the original message never reaches the client.
    // Router handlers must throw ORPCError(code, { message }) so client
    // errors (BAD_REQUEST/UNAUTHORIZED/NOT_FOUND/…) survive as such.
    //
    // `src/lib` is in scope too: the router delegates the whole apply path to
    // the *-handlers modules there (via handleRequest), so a raw throw one hop
    // down the call stack reaches oRPC and gets masked exactly the same way.
    files: ["src/router/**/*.ts", "src/lib/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='logger'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/]",
          message:
            "Use the log* helpers (logDebug/logInfo/logError/…) instead of the raw pino logger. Reserve `logger` for `logger.child()`.",
        },
        {
          // Any constructed throw that isn't an ORPCError: `new Error`,
          // `new TypeError`, a custom `new DomainError`, etc. Negating the name
          // rather than listing constructors means a new error class is covered
          // the day it's written. Bare `throw err` (a rethrow) is an Identifier,
          // not a NewExpression, so it stays allowed.
          selector: "ThrowStatement > NewExpression[callee.name!='ORPCError']",
          message: ORPC_ERROR_MESSAGE,
        },
        {
          // The no-`new` call form — `throw Error("...")` is valid JS and just
          // as masked. Limited to the built-in error constructors on purpose:
          // a blanket CallExpression selector would also flag factory helpers
          // that return an ORPCError (e.g. `throw mapSlackError(...)` in
          // src/router/slack.ts).
          selector:
            "ThrowStatement > CallExpression[callee.name=/^(Error|AggregateError|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError)$/]",
          message: ORPC_ERROR_MESSAGE,
        },
      ],
    },
  },
];
