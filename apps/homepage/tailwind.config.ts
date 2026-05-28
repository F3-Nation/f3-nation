import type { Config } from "tailwindcss";
import baseConfig from "@acme/tailwind-config/web";

export default {
  content: [
    ...baseConfig.content,
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  presets: [baseConfig],
} satisfies Config;
