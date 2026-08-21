import vitestPlugin from "@vitest/eslint-plugin";

/** @type {import("typescript-eslint").ConfigArray} */
export default [
  {
    files: ["**/*.test.{ts,tsx}"],
    plugins: { vitest: vitestPlugin },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      // Pre-existing violations (~86, permission tests that assert inside an
      // `if`) are tracked as follow-up cleanup rather than fixed here — see
      // https://github.com/F3-Nation/f3-nation/issues/837. Every other
      // recommended rule (no-focused-tests, no-standalone-expect,
      // valid-expect, …) is already clean and stays enabled.
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: ["expect", "expect*", "assert*", "pass", "fail"],
        },
      ],
      "vitest/no-conditional-expect": "off",
    },
  },
];
