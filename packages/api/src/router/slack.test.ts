import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("../logger", () => ({ logError, logWarn: vi.fn() }));

import { callSlackWebApi, mapSlackError } from "./slack";

// Slack throttling us is reported to the error tracker where it's detected,
// while the client keeps 429 semantics; Slack faults that are ours (bad
// channel, stale message, bad blocks) are reported too, even though they map
// to 4xx for the caller.
const call = () =>
  callSlackWebApi({
    url: "https://slack.com/api/chat.postMessage",
    botToken: "xoxb-test",
    payload: { channel: "C1", text: "hi" },
  });

const respond = (status: number, body: string) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("callSlackWebApi throttling and faults", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [
      "a JSON ratelimited body",
      200,
      JSON.stringify({ ok: false, error: "ratelimited" }),
    ],
    ["HTTP 429 with a non-JSON body", 429, "Too Many Requests"],
    [
      "HTTP 429 with a JSON body",
      429,
      JSON.stringify({ ok: false, error: "ratelimited" }),
    ],
    // Checked before `ok`: a 429 whose body names another error is still a throttle.
    [
      "HTTP 429 whose body names another error",
      429,
      JSON.stringify({ ok: false, error: "invalid_auth" }),
    ],
  ])(
    "returns 429 and reports the upstream throttle for %s",
    async (_name, status, body) => {
      respond(status, body);
      await expect(call()).rejects.toMatchObject({
        status: 429,
        code: "TOO_MANY_REQUESTS",
      });
      expect(logError).toHaveBeenCalledWith(
        "api.slack.upstream_ratelimited",
        {},
      );
    },
  );

  it.each([
    ["channel_not_found", 404],
    ["not_in_channel", 404],
    ["cant_update_message", 403],
    ["invalid_blocks", 400],
  ])(
    "reports the integration fault %s while returning %i",
    async (slackError, status) => {
      respond(200, JSON.stringify({ ok: false, error: slackError }));
      await expect(call()).rejects.toMatchObject({ status });
      expect(logError).toHaveBeenCalledWith("api.slack.integration_fault", {
        slackError,
      });
    },
  );

  it("doesn't report caller-side Slack errors", async () => {
    respond(200, JSON.stringify({ ok: false, error: "message_not_found" }));
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(logError).not.toHaveBeenCalled();
  });

  it("returns the message identifiers on success", async () => {
    respond(200, JSON.stringify({ ok: true, channel: "C1", ts: "1.2" }));
    await expect(call()).resolves.toEqual({
      ok: true,
      channel: "C1",
      ts: "1.2",
    });
    expect(logError).not.toHaveBeenCalled();
  });
});

describe("mapSlackError", () => {
  it("keeps upstream throttling as 429 for the client", () => {
    expect(mapSlackError("ratelimited")).toMatchObject({
      status: 429,
      code: "TOO_MANY_REQUESTS",
    });
  });
});

describe("callSlackWebApi token_revoked retry", () => {
  const revoked = () =>
    new Response(JSON.stringify({ ok: false, error: "token_revoked" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const success = () =>
    new Response(JSON.stringify({ ok: true, channel: "C1", ts: "1.0" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const callWithReload = (reloadBotToken: () => Promise<string>) =>
    callSlackWebApi({
      url: "https://slack.com/api/chat.postMessage",
      botToken: "xoxb-old",
      payload: { channel: "C1", text: "hi" },
      reloadBotToken,
    });

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("retries once with the reloaded token after token_revoked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(revoked())
      .mockResolvedValueOnce(success());
    const reload = vi.fn().mockResolvedValue("xoxb-new");

    await expect(callWithReload(reload)).resolves.toEqual({
      ok: true,
      channel: "C1",
      ts: "1.0",
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const authorizationOf = (callIndex: number) => {
      const init = fetchMock.mock.calls[callIndex]?.[1];
      return new Headers(init?.headers).get("Authorization");
    };
    expect(authorizationOf(0)).toBe("Bearer xoxb-old");
    expect(authorizationOf(1)).toBe("Bearer xoxb-new");
  });

  it("doesn't retry when the reloaded token is unchanged", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(revoked());
    const reload = vi.fn().mockResolvedValue("xoxb-old");

    await expect(callWithReload(reload)).rejects.toMatchObject({
      status: mapSlackError("token_revoked").status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry twice", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(revoked())
      .mockResolvedValueOnce(revoked());
    const reload = vi.fn().mockResolvedValue("xoxb-new");

    await expect(callWithReload(reload)).rejects.toMatchObject({
      status: mapSlackError("token_revoked").status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("surfaces the Slack error when the reload fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(revoked());
    const reload = vi.fn().mockRejectedValue(new Error("no token"));

    await expect(callWithReload(reload)).rejects.toMatchObject({
      status: mapSlackError("token_revoked").status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
