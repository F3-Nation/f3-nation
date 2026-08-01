import { describe, expect, it } from "vitest";

import { redactSecret } from "./redact";

describe("redactSecret", () => {
  it("returns '(unset)' for undefined", () => {
    expect(redactSecret(undefined)).toBe("(unset)");
  });

  it("fully masks short values instead of partially revealing them", () => {
    expect(redactSecret("short")).toBe("****");
    expect(redactSecret("12345678")).toBe("****");
  });

  it("shows first 4 and last 4 characters of longer values", () => {
    expect(redactSecret("sk-ant-abcdefghijklmnop-wxyz")).toBe("sk-a…wxyz");
  });

  it("never contains the full secret in its output", () => {
    const secret = "super-secret-api-key-value-12345";
    expect(redactSecret(secret)).not.toContain(secret);
  });
});
