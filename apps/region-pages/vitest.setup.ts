import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, vi } from "vitest";

// Register through our own `expect`. "@testing-library/jest-dom/vitest" imports
// jest-dom's peer copy of vitest, which pnpm can resolve to a second instance
// and break `rejects.toThrow(...)`.
expect.extend(matchers);

vi.mock("server-only", () => ({}));
