import type { Config } from "tailwindcss";

import baseConfig from "@acme/tailwind-config/web";

const SIDEBAR_WIDTH = 360;

export default {
  // We need to append the path to the UI package to the content array so that
  // those classes are included correctly.
  content: [...baseConfig.content, "../../packages/ui/**/*.{ts,tsx}"],
  presets: [baseConfig],
  theme: {
    extend: {
      spacing: {
        360: `${SIDEBAR_WIDTH}px`,
      },
      screens: {
        xs: "480px",
      },
    },
  },
} satisfies Config;
