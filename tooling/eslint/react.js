import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";

/** @type {import("typescript-eslint").ConfigArray} */
export default [
  // Use flat config which supports ESLint 10 flat config format.
  // Note: set settings.react.version explicitly — using "detect" calls
  // context.getFilename() which was removed in ESLint 10.
  reactPlugin.configs.flat.recommended,
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
    },
    settings: {
      react: {
        version: "18.3.1",
      },
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      "react/prop-types": "off",
      // React 17+ JSX transform doesn't require importing React
      "react/react-in-jsx-scope": "off",
      // eslint-plugin-react-hooks v7 enables these React Compiler rules in
      // `recommended`. They flag real anti-patterns but adopting them is a
      // refactor tracked separately — see https://github.com/F3-Nation/f3-nation/issues/507.
      // Opt out for now (must be "off", not "warn": lint runs --max-warnings 0).
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
];
