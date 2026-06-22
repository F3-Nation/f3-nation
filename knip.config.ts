import { KnipConfig } from "knip";

const config: KnipConfig = {
  treatConfigHintsAsErrors: true,
  ignoreDependencies: [
    // Ambient global types — referenced as `google.maps.*` throughout the codebase, not imported explicitly
    "@types/google.maps",
  ],
};

export default config;
