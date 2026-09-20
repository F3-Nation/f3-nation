import baseConfig from "@acme/eslint-config/base";

import vitestConfig from "./vitest.js";

export default [...baseConfig, ...vitestConfig];
