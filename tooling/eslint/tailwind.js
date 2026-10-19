import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import betterTailwindPlugin from "eslint-plugin-better-tailwindcss";

// Mirrors the plugin's lookup: node_modules walk-up only. require.resolve
// would also honor the NODE_PATH that `pnpm run` sets, which the plugin ignores.
/** @param {string} dir */
function hasTailwind(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules/tailwindcss/package.json")))
      return true;
    if (dirname(d) === d) return false;
  }
}

// Non-Tailwind classes we use on purpose as CSS/test hooks.
const ignoredClasses = [
  "^marker$",
  "^cluster$",
  "^feature$",
  "^test$",
  "^toaster$",
  "^lucide(-.*)?$",
];

/**
 * Tailwind class checks (unknown, conflicting, duplicate, deprecated).
 *
 * @param {{ entryPoint: string }} options `entryPoint` is the workspace's
 *   Tailwind CSS entry, relative to the workspace root, so app-specific
 *   `@theme` tokens count as known classes.
 * @returns {import("typescript-eslint").ConfigArray}
 */
export default function tailwindConfig({ entryPoint }) {
  // The plugin resolves tailwindcss from the lint cwd and, if that fails,
  // disables its rules with only a console warning. Fail loudly instead.
  if (!hasTailwind(process.cwd())) {
    throw new Error(
      `@acme/eslint-config/tailwind: cannot resolve "tailwindcss" from ${process.cwd()}. Add it to this workspace's devDependencies.`,
    );
  }

  return [
    {
      files: ["**/*.{ts,tsx}"],
      // Tests pass placeholder class names to helpers like `cn()`.
      ignores: ["**/*.test.{ts,tsx}", "**/__tests__/**"],
      plugins: { "better-tailwindcss": betterTailwindPlugin },
      settings: { "better-tailwindcss": { entryPoint } },
      rules: {
        "better-tailwindcss/no-unknown-classes": [
          "error",
          { ignore: ignoredClasses },
        ],
        "better-tailwindcss/no-conflicting-classes": "error",
        "better-tailwindcss/no-duplicate-classes": "error",
        "better-tailwindcss/no-deprecated-classes": "error",
      },
    },
  ];
}
