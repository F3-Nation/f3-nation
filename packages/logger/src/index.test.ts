import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { redactDeep } from "./index";

describe("redactDeep", () => {
  it("censors a root-level matching key", () => {
    expect(redactDeep({ token: "secret", userId: 1 })).toEqual({
      token: "[REDACTED]",
      userId: 1,
    });
  });

  it("censors nested objects at any depth", () => {
    expect(redactDeep({ a: { b: { c: { accessToken: "secret" } } } })).toEqual({
      a: { b: { c: { accessToken: "[REDACTED]" } } },
    });
  });

  it("censors matching keys inside arrays and arrays of objects", () => {
    expect(
      redactDeep({ users: [{ email: "a@b.com" }, { userId: 2 }] }),
    ).toEqual({
      users: [{ email: "[REDACTED]" }, { userId: 2 }],
    });
    expect(redactDeep(["x", { password: "hunter2" }])).toEqual([
      "x",
      { password: "[REDACTED]" },
    ]);
  });

  it("censors camelCase and snake_case variants alike", () => {
    expect(
      redactDeep({ accessToken: "a", access_token: "b", refreshToken: "c" }),
    ).toEqual({
      accessToken: "[REDACTED]",
      access_token: "[REDACTED]",
      refreshToken: "[REDACTED]",
    });
  });

  it("leaves non-matching keys and primitives untouched", () => {
    const input = { requestId: "r-1", count: 3, ok: true, note: null };
    expect(redactDeep(input)).toEqual(input);
  });

  it("does not throw on circular references", () => {
    const obj: Record<string, unknown> = { token: "secret" };
    obj.self = obj;
    expect(() => redactDeep(obj)).not.toThrow();
  });
});

function createCapturingStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

describe("redaction via pino's formatters.log hook", () => {
  it("redacts nested and array fields in real serialized output", () => {
    const { stream, lines } = createCapturingStream();
    const logger = pino(
      {
        formatters: {
          log: (obj) => redactDeep(obj) as Record<string, unknown>,
        },
      },
      stream,
    );

    logger.info(
      { tokens: { accessToken: "secret" }, creds: [{ apiKey: "k" }] },
      "test.event",
    );

    const line = JSON.parse(lines[0] ?? "{}") as {
      tokens: { accessToken: string };
      creds: { apiKey: string }[];
    };
    expect(line.tokens.accessToken).toBe("[REDACTED]");
    expect(line.creds[0]?.apiKey).toBe("[REDACTED]");
  });
});
