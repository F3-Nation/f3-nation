import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import {
  apiRetryDelayMs,
  API_RETRY_BASE_MS,
  isApiUnavailableError,
  isUpstreamFailureResponse,
} from "@acme/shared/app/api-availability";

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
    // A bug in our own code must not masquerade as an outage.
    [
      "an unrelated TypeError",
      new TypeError("Cannot read properties of undefined"),
    ],
    ["an unrelated DOMException", new DOMException("bad", "SyntaxError")],
    ["a plain Error", new Error("boom")],
    [
      "an Error with a numeric status only",
      Object.assign(new Error("x"), { status: 503 }),
    ],
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

describe("isUpstreamFailureResponse", () => {
  it("flags a non-JSON 5xx", () => {
    const response = new Response("<h1>Bad Gateway</h1>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    expect(isUpstreamFailureResponse(response)).toBe(true);
  });

  it("flags a 5xx with no content-type", () => {
    const response = new Response("oops", { status: 503 });
    response.headers.delete("content-type");
    expect(isUpstreamFailureResponse(response)).toBe(true);
  });

  it("leaves a JSON 5xx for oRPC to decode", () => {
    expect(isUpstreamFailureResponse(Response.json({}, { status: 500 }))).toBe(
      false,
    );
  });

  it("leaves a successful or 4xx response alone", () => {
    expect(isUpstreamFailureResponse(new Response("ok"))).toBe(false);
    expect(isUpstreamFailureResponse(new Response("no", { status: 404 }))).toBe(
      false,
    );
  });
});

describe("apiRetryDelayMs", () => {
  it("stays within ±20% of the base delay", () => {
    expect(apiRetryDelayMs(() => 0)).toBe(API_RETRY_BASE_MS * 0.8);
    expect(apiRetryDelayMs(() => 0.5)).toBe(API_RETRY_BASE_MS);
    expect(apiRetryDelayMs(() => 0.999999)).toBeLessThanOrEqual(
      API_RETRY_BASE_MS * 1.2,
    );
  });
});
