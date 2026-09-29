import { describe, expect, it } from "vitest";

import { redactQueryParams, rootCause } from "./error-details";

describe("rootCause", () => {
  it("is undefined for an error without a cause", () => {
    expect(rootCause(new Error("boom"))).toBeUndefined();
  });

  it("returns the innermost error of a chain", () => {
    const inner = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    const middle = new Error("middle", { cause: inner });
    expect(rootCause(new Error("outer", { cause: middle }))).toBe(inner);
  });

  it("wraps a non-Error cause and stops there", () => {
    const root = rootCause(new Error("outer", { cause: "socket hang up" }));
    expect(root).toBeInstanceOf(Error);
    expect(root?.message).toBe("socket hang up");
  });

  it("descends into the first member of an empty-message AggregateError", () => {
    const first = new Error("connect ECONNREFUSED ::1:5432");
    const aggregate = new AggregateError([first, new Error("second")], "");
    expect(rootCause(new Error("outer", { cause: aggregate }))).toBe(first);
  });

  it("keeps an AggregateError that has its own message", () => {
    const aggregate = new AggregateError([new Error("x")], "1/1 failed");
    expect(rootCause(new Error("outer", { cause: aggregate }))).toBe(aggregate);
  });

  it("terminates on a cause cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(rootCause(a)).toBe(b);
  });
});

describe("redactQueryParams", () => {
  it("redacts the params of a Drizzle message", () => {
    expect(
      redactQueryParams(
        "Failed query: select $1::text\nparams: pii@example.com,Jane",
      ),
    ).toBe("Failed query: select $1::text\nparams: [redacted]");
  });

  it("redacts multi-line params in a stack but keeps the frames", () => {
    const stack = [
      "Error: Failed query: insert into t (a) values ($1)",
      "params: line one",
      "line two of a backblast",
      "    at PostgresJsPreparedQuery.queryWithCache (session.js:41:15)",
      "    at handler (router.ts:10:3)",
    ].join("\n");
    expect(redactQueryParams(stack)).toBe(
      [
        "Error: Failed query: insert into t (a) values ($1)",
        "params: [redacted]",
        "    at PostgresJsPreparedQuery.queryWithCache (session.js:41:15)",
        "    at handler (router.ts:10:3)",
      ].join("\n"),
    );
  });

  it("leaves text without the Drizzle shape unchanged", () => {
    expect(redactQueryParams("params: not a query")).toBe(
      "params: not a query",
    );
    expect(redactQueryParams("connect ECONNREFUSED 127.0.0.1:1")).toBe(
      "connect ECONNREFUSED 127.0.0.1:1",
    );
  });
});
