import { describe, expect, it } from "vitest";

describe("API Utilities", () => {
  describe("Environment", () => {
    it("should have NODE_ENV defined", () => {
      expect(process.env.NODE_ENV).toBeDefined();
    });

    it("should be in test environment", () => {
      expect(process.env.NODE_ENV).toBe("test");
    });
  });

  describe("Basic Math Operations", () => {
    it("should add numbers correctly", () => {
      expect(1 + 1).toBe(2);
    });

    it("should multiply numbers correctly", () => {
      expect(5 * 3).toBe(15);
    });
  });

  describe("String Operations", () => {
    it("should concatenate strings", () => {
      const hello = "Hello";
      const world = "World";
      expect(`${hello}, ${world}!`).toBe("Hello, World!");
    });

    it("should convert to uppercase", () => {
      expect("test".toUpperCase()).toBe("TEST");
    });
  });
});
