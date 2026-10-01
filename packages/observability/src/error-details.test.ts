import { describe, expect, it } from "vitest";

import {
  redactCauseMessage,
  redactQueryParams,
  redactStack,
  rootCause,
} from "./error-details";

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

  it("wraps a non-Error cause whose toString throws", () => {
    const cause = {
      toString() {
        throw new Error("no");
      },
    };
    expect(rootCause(new Error("outer", { cause }))?.message).toBe(
      "[unstringifiable error value]",
    );
  });

  it("survives a throwing cause getter", () => {
    const error = new Error("outer");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("getter boom");
      },
    });
    expect(rootCause(error)).toBeUndefined();
  });

  it("keeps the deepest cause reached before a throwing getter", () => {
    const middle = new Error("middle");
    Object.defineProperty(middle, "cause", {
      get() {
        throw new Error("getter boom");
      },
    });
    expect(rootCause(new Error("outer", { cause: middle }))).toBe(middle);
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

  it("leaves messages without the Drizzle shape unchanged", () => {
    expect(redactQueryParams("params: not a query")).toBe(
      "params: not a query",
    );
    expect(redactQueryParams("Failed query: select 1")).toBe(
      "Failed query: select 1",
    );
  });
});

describe("redactStack", () => {
  const message = "Failed query: insert into t (a) values ($1)\nparams: x";

  it("swaps the exact message in the stack header, keeping the frames", () => {
    const stack = `Error: ${message}\n    at handler (router.ts:10:3)`;
    expect(redactStack(stack, message)).toBe(
      "Error: Failed query: insert into t (a) values ($1)\nparams: [redacted]\n    at handler (router.ts:10:3)",
    );
  });

  it("redacts a bound value that itself looks like a stack frame", () => {
    // Regression: a params value containing "\n    at …" must not be
    // mistaken for the first frame and kept.
    const tricky =
      "Failed query: select $1::text\nparams: hi\n    at secret@example.com";
    const stack = `Error: ${tricky}\n    at handler (router.ts:10:3)`;
    const redacted = redactStack(stack, tricky);
    expect(redacted).not.toContain("secret@example.com");
    expect(redacted).toContain("params: [redacted]\n    at handler");
  });

  it("drops the stack when the raw message can't be found in it", () => {
    expect(
      redactStack("Error: something else\n    at x (y.ts:1:1)", message),
    ).toBeUndefined();
  });

  it("returns a stack unchanged when the message has no params", () => {
    const stack = "Error: boom\n    at x (y.ts:1:1)";
    expect(redactStack(stack, "boom")).toBe(stack);
  });

  it("is undefined for a missing stack", () => {
    expect(redactStack(undefined, message)).toBeUndefined();
  });
});

describe("redactCauseMessage", () => {
  it.each([
    [
      'invalid input syntax for type uuid: "alice@example.com"',
      'invalid input syntax for type uuid: "[redacted]"',
    ],
    [
      'invalid input value for enum org_type: "my secret"',
      'invalid input value for enum org_type: "[redacted]"',
    ],
    [
      'value "99999999999" is out of range for type integer',
      'value "[redacted]" is out of range for type integer',
    ],
    [
      'date/time field value out of range: "2026-99-99"',
      'date/time field value out of range: "[redacted]"',
    ],
  ])("redacts the value Postgres quotes back: %s", (input, expected) => {
    expect(redactCauseMessage(input)).toBe(expected);
  });

  it("keeps quoted schema identifiers", () => {
    expect(redactCauseMessage('relation "users" does not exist')).toBe(
      'relation "users" does not exist',
    );
    expect(
      redactCauseMessage(
        'duplicate key value violates unique constraint "users_email_key"',
      ),
    ).toBe('duplicate key value violates unique constraint "users_email_key"');
  });

  it("redacts a value that itself contains a double quote", () => {
    // Postgres doesn't escape quotes inside the echoed value.
    const out = redactCauseMessage(
      'invalid input syntax for type uuid: "alice"secret@example.com"',
    );
    expect(out).toBe('invalid input syntax for type uuid: "[redacted]"');
    expect(out).not.toContain("secret");
    const mid = redactCauseMessage(
      'value "12"34" is out of range for type integer',
    );
    expect(mid).toBe('value "[redacted]" is out of range for type integer');
  });

  it("fails closed: an unterminated quote is redacted to the end", () => {
    expect(redactCauseMessage('bad input: "unterminated secret')).toBe(
      'bad input: "[redacted]"',
    );
  });

  it("over-redacts rather than under-redacts when several values appear", () => {
    expect(redactCauseMessage('a: "x" and b: "y"')).toBe('a: "[redacted]"');
  });

  it("also redacts Drizzle params", () => {
    expect(
      redactCauseMessage("Failed query: select $1\nparams: pii@example.com"),
    ).toBe("Failed query: select $1\nparams: [redacted]");
  });

  it("is applied by redactStack when passed as the redactor", () => {
    const message = 'invalid input syntax for type uuid: "alice@example.com"';
    expect(
      redactStack(
        `error: ${message}\n    at Parser.parseErrorMessage (x.js:1:1)`,
        message,
        redactCauseMessage,
      ),
    ).toBe(
      'error: invalid input syntax for type uuid: "[redacted]"\n    at Parser.parseErrorMessage (x.js:1:1)',
    );
  });
});
