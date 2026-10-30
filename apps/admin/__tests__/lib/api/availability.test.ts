import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { isApiUnavailableError } from "@acme/shared/common/api-availability";

describe("isApiUnavailableError", () => {
  it.each([
    ["a 5xx response", new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 })],
    [
      "a 503 from a load balancer",
      new ORPCError("SERVICE_UNAVAILABLE", { status: 503 }),
    ],
    ["a request timeout", new DOMException("timed out", "TimeoutError")],
    // What Node's fetch rejects with on DNS, refused, or reset connections.
    ["a connection failure", new TypeError("fetch failed")],
    ["a connection dropped mid-body", new TypeError("terminated")],
    // oRPC wraps failures while reading the body, keeping the real one as cause.
    [
      "a timeout while reading the body",
      new Error("Cannot parse response body", {
        cause: new DOMException("timed out", "TimeoutError"),
      }),
    ],
    [
      "a connection dropped while reading the body",
      new Error("Cannot parse response body", {
        cause: new TypeError("terminated"),
      }),
    ],
  ])("treats %s as unavailable", (_label, error) => {
    expect(isApiUnavailableError(error)).toBe(true);
  });

  it.each([
    // The API answered, so it is up; these are not outages.
    ["a 401", new ORPCError("UNAUTHORIZED", { status: 401 })],
    ["a 404", new ORPCError("NOT_FOUND", { status: 404 })],
    ["a 429", new ORPCError("TOO_MANY_REQUESTS", { status: 429 })],
    // The caller cancelled it (unmount, navigation); timeouts are TimeoutError.
    ["an aborted request", new DOMException("aborted", "AbortError")],
    // A bug in our own code must not masquerade as an outage.
    [
      "an unrelated TypeError",
      new TypeError("Cannot read properties of undefined"),
    ],
    ["an unrelated DOMException", new DOMException("bad", "SyntaxError")],
    ["a plain Error", new Error("boom")],
    [
      "an Error caused by a plain Error",
      new Error("x", { cause: new Error("y") }),
    ],
    // A malformed body from a healthy API is a bug, not an outage.
    [
      "a body that is not valid JSON",
      new Error("Cannot parse response body", {
        cause: new SyntaxError("Unexpected token"),
      }),
    ],
    ["a non-Error rejection", "gateway timeout"],
    ["undefined", undefined],
  ])("does not treat %s as unavailable", (_label, error) => {
    expect(isApiUnavailableError(error)).toBe(false);
  });
});

describe("isApiUnavailableError cause chain", () => {
  it("stops following a cyclic cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.defineProperty(a, "cause", { value: b });

    expect(isApiUnavailableError(a)).toBe(false);
  });

  it("does not look past the depth limit", () => {
    let error: unknown = new TypeError("fetch failed");
    for (let i = 0; i < 4; i++)
      error = new Error(`wrap ${i}`, { cause: error });

    expect(isApiUnavailableError(error)).toBe(false);
  });
});
