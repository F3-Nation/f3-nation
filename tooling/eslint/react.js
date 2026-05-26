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
    },
  },
];
