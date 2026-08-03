import baseConfig from "@acme/eslint-config/base";

const ORPC_ERROR_MESSAGE =
  "Throw `new ORPCError(code, { message })` instead of a raw Error — oRPC masks non-ORPCError throws as an opaque 500 and drops the message. Use BAD_REQUEST for invalid/missing input, FORBIDDEN for permission checks, NOT_FOUND for a missing referenced resource, and INTERNAL_SERVER_ERROR only for truly unexpected server state.";

export default [
  ...baseConfig,
  { ignores: ["vitest.config.ts", "__tests__", "coverage"] },
  {
    // oRPC masks any thrown value that isn't an ORPCError as an opaque 500
    // INTERNAL_SERVER_ERROR — the original message never reaches the client.
    // Router handlers must throw ORPCError(code, { message }) so client
    // errors (BAD_REQUEST/FORBIDDEN/NOT_FOUND/…) survive as such.
    files: ["src/router/**/*.ts"],
    ignores: ["src/router/**/*.test.ts"],
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
          selector: "ThrowStatement > NewExpression[callee.name!='ORPCError']",
          message: ORPC_ERROR_MESSAGE,
        },
        {
          selector:
            "ThrowStatement > CallExpression[callee.name=/^(Error|AggregateError|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError)$/]",
          message: ORPC_ERROR_MESSAGE,
        },
      ],
    },
  },
];
