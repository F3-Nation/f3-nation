import { vi } from "vitest";

// Mock the OpenAPI document generation
vi.mock("../src/openApi", () => ({
  openApiDocument: {},
}));

console.log("Test setup code should go here");
