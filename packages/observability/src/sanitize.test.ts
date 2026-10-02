import { describe, expect, it } from "vitest";

import { sanitizeLogContext } from "./sanitize";

describe("sanitizeLogContext", () => {
  it("passes through a context with nothing sensitive in it", () => {
    expect(
      sanitizeLogContext({ orgId: 12, route: "/v1/test", ok: true }),
    ).toEqual({ orgId: 12, route: "/v1/test", ok: true });
  });

  it.each([
    "token",
    "accessToken",
    "SECRET",
    "password",
    "passwd",
    "credentials",
    "authorization",
    "cookie",
    "sessionId",
    "apiKey",
    "api_key",
    "api-key",
    "privateKey",
  ])("redacts the top-level key %s", (key) => {
    expect(sanitizeLogContext({ [key]: "hunter2" })).toEqual({
      [key]: "[redacted]",
    });
  });

  it("redacts nested keys, not just top-level ones", () => {
    expect(
      sanitizeLogContext({
        request: { headers: { authorization: "Bearer abc", accept: "json" } },
      }),
    ).toEqual({
      request: { headers: { authorization: "[redacted]", accept: "json" } },
    });
  });

  it("recurses through arrays", () => {
    expect(
      sanitizeLogContext({ users: [{ id: 1, password: "p" }, { id: 2 }] }),
    ).toEqual({ users: [{ id: 1, password: "[redacted]" }, { id: 2 }] });
  });

  it("marks circular references instead of recursing forever", () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;

    expect(sanitizeLogContext({ node })).toEqual({
      node: { id: 1, self: "[circular]" },
    });
  });

  it("does not treat a repeated sibling as circular", () => {
    const shared = { id: 1 };

    expect(sanitizeLogContext({ a: shared, b: shared })).toEqual({
      a: { id: 1 },
      b: { id: 1 },
    });
  });

  it("leaves null and primitives alone", () => {
    expect(
      sanitizeLogContext({ nothing: null, count: 0, flag: false, s: "x" }),
    ).toEqual({ nothing: null, count: 0, flag: false, s: "x" });
  });

  it("redacts a whole subtree when the key itself is sensitive", () => {
    expect(
      sanitizeLogContext({ credentials: { user: "a", pass: "b" } }),
    ).toEqual({ credentials: "[redacted]" });
  });
});
