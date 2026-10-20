import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { isApiUnavailableError } from "~/lib/api/availability";

describe("isApiUnavailableError", () => {
  it.each([
    ["a 5xx response", new ORPCError("INTERNAL_SERVER_ERROR", { status: 500 })],
    [
      "a 503 from a load balancer",
      new ORPCError("SERVICE_UNAVAILABLE", { status: 503 }),
    ],
    ["a request timeout", new DOMException("timed out", "TimeoutError")],
    ["an aborted request", new DOMException("aborted", "AbortError")],
    // What Node's fetch rejects with on DNS, refused, or reset connections.
    ["a connection failure", new TypeError("fetch failed")],
  ])("treats %s as unavailable", (_label, error) => {
    expect(isApiUnavailableError(error)).toBe(true);
  });

  it.each([
    // The API answered, so it is up; these are not outages.
    ["a 401", new ORPCError("UNAUTHORIZED", { status: 401 })],
    ["a 404", new ORPCError("NOT_FOUND", { status: 404 })],
    ["a 429", new ORPCError("TOO_MANY_REQUESTS", { status: 429 })],
    // A bug in our own code must not masquerade as an outage.
    [
      "an unrelated TypeError",
      new TypeError("Cannot read properties of undefined"),
    ],
    ["an unrelated DOMException", new DOMException("bad", "SyntaxError")],
    ["a plain Error", new Error("boom")],
    ["a non-Error rejection", "gateway timeout"],
    ["undefined", undefined],
  ])("does not treat %s as unavailable", (_label, error) => {
    expect(isApiUnavailableError(error)).toBe(false);
  });
});
