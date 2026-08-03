/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        // apps
        "admin",
        "homepage",
        "map",
        "me",
        "slackbot",
        "analytics",

        // apps & packages (exist in both apps/ and packages/)
        "api",
        "auth",

        // packages
        "db",
        "env",
        "mail",
        "shared",
        "sso",
        "storage",
        "ui",
        "validators",

        // tooling
        "eslint",
        "prettier",
        "tsconfig",
        "scripts",
        "github",
        "tailwind",

        // cross-cutting
        "deps",
        "ci",
        "repo",
        "release",

        // release-please uses the target branch as the scope (e.g. "chore(main): release me 1.2.0")
        "main",
      ],
    ],
    "scope-empty": [2, "never"],
  },
  prompt: {
    settings: {
      enableMultipleScopes: true,
      scopeEnumSeparator: ",",
    },
  },
};
