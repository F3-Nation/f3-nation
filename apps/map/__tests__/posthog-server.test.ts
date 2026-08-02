import { describe, it, expect, vi, beforeEach } from "vitest";

const captureExceptionImmediateMock = vi.hoisted(() => vi.fn());
const PostHogMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: unknown) {
    Object.assign(this as object, {
      captureExceptionImmediate: captureExceptionImmediateMock,
    });
  }),
);
const envMock = vi.hoisted(
  (): { NEXT_PUBLIC_POSTHOG_KEY: string | undefined; F3_CHANNEL: string } => ({
    NEXT_PUBLIC_POSTHOG_KEY: "test-key",
    F3_CHANNEL: "ci",
  }),
);
const setErrorReporterMock = vi.hoisted(() => vi.fn());

vi.mock("posthog-node", () => ({ PostHog: PostHogMock }));
vi.mock("~/env", () => ({ env: envMock }));
vi.mock("@acme/logger", () => ({
  setErrorReporter: setErrorReporterMock,
}));

describe("posthog-server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    envMock.NEXT_PUBLIC_POSTHOG_KEY = "test-key";
  });

  it("is a no-op when no key is configured", async () => {
    envMock.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    const { captureServerException } = await import("../src/posthog-server");
    await captureServerException(new Error("boom"));
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("captures an exception with the environment and extra properties", async () => {
    const { captureServerException } = await import("../src/posthog-server");
    const error = new Error("boom");
    await captureServerException(error, { route: "/[locale]/map" });
    expect(captureExceptionImmediateMock).toHaveBeenCalledWith(
      error,
      undefined,
      { environment: "ci", route: "/[locale]/map" },
    );
  });

  it("wraps non-Error values in a real Error", async () => {
    const { captureServerException } = await import("../src/posthog-server");
    await captureServerException("not an error");
    const [reportedError] = captureExceptionImmediateMock.mock.calls[0] as [
      Error,
    ];
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError.message).toBe("not an error");
  });

  it("logs (but never throws) when the PostHog transport fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    captureExceptionImmediateMock.mockRejectedValueOnce(
      new Error("network down"),
    );
    const { captureServerException } = await import("../src/posthog-server");
    await expect(
      captureServerException(new Error("boom")),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "posthog.capture_exception_failed",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("registers a reporter that cannot have its event overwritten by ctx", async () => {
    const { registerPostHogErrorReporter } =
      await import("../src/posthog-server");
    registerPostHogErrorReporter();
    expect(setErrorReporterMock).toHaveBeenCalledOnce();
    const reporter = setErrorReporterMock.mock.calls[0]?.[0] as (
      event: string,
      ctx: Record<string, unknown>,
      err?: unknown,
    ) => void;

    reporter("real.event", { event: "spoofed.event", userId: "123" });
    await vi.waitFor(() => {
      expect(captureExceptionImmediateMock).toHaveBeenCalled();
    });
    expect(captureExceptionImmediateMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "real.event" }),
      undefined,
      { environment: "ci", userId: "123", event: "real.event" },
    );
  });
});
