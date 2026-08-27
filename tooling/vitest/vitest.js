import vitestPlugin from "@vitest/eslint-plugin";

/** @type {import("typescript-eslint").ConfigArray} */
export default [
  {
    files: ["**/*.test.{ts,tsx}"],
    plugins: { vitest: vitestPlugin },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: ["expect", "expect*", "assert*", "pass", "fail"],
        },
      ],
      // Disabled pending https://github.com/F3-Nation/f3-nation/issues/877
      "vitest/no-conditional-expect": "off",
    },
  },
];
