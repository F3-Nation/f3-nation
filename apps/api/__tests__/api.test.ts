import { describe, expect, it } from "vitest";

describe("API Sanity Test", () => {
  it("should pass a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("should have NODE_ENV defined", () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });

  it("should be able to import and run basic functions", () => {
    const testFunction = () => "Hello, World!";
    expect(testFunction()).toBe("Hello, World!");
  });
});
