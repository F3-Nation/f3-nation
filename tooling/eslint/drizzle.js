import drizzlePlugin from "eslint-plugin-drizzle";

/** @type {import("typescript-eslint").ConfigArray} */
export default [
  {
    plugins: { drizzle: drizzlePlugin },
    rules: {
      // drizzleObjectName covers `db`/`ctx.db`, the `tx` transaction callback
      // param, and `client` (packages/auth's drizzle adapter) — the plugin's
      // default (unscoped) matches ANY `.delete()`/`.update()` call,
      // including unrelated ones like Map/Headers/URLSearchParams.
      "drizzle/enforce-delete-with-where": [
        "error",
        { drizzleObjectName: ["db", "tx", "client"] },
      ],
      "drizzle/enforce-update-with-where": [
        "error",
        { drizzleObjectName: ["db", "tx", "client"] },
      ],
    },
  },
];
