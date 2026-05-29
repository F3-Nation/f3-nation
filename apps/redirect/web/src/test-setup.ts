import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

// Explicitly extend vitest's expect with the jest-dom matchers (more robust
// than the /vitest auto-import under the monorepo's dependency resolution).
expect.extend(matchers);

// Unmount React trees between tests so the jsdom DOM doesn't leak across cases.
afterEach(() => cleanup());
