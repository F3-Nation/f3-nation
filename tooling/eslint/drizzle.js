import drizzlePlugin from "eslint-plugin-drizzle";

/** @type {import("typescript-eslint").ConfigArray} */
export default [
  {
    plugins: { drizzle: drizzlePlugin },
    rules: {
      // drizzleObjectName covers `db`/`ctx.db`, the `tx` transaction callback
      // param, `client` (packages/auth's drizzle adapter), and `dbInstance`
      // (an alias used in packages/api/src/router/user.test.ts) — the
      // plugin's default (unscoped) matches ANY `.delete()`/`.update()`
      // call, including unrelated ones like Map/Headers/URLSearchParams.
      "drizzle/enforce-delete-with-where": [
        "error",
        { drizzleObjectName: ["db", "tx", "client", "dbInstance"] },
      ],
      "drizzle/enforce-update-with-where": [
        "error",
        { drizzleObjectName: ["db", "tx", "client", "dbInstance"] },
      ],
    },
  },
];
