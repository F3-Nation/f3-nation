import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupAuditStack } from "../tests/audit-cleanup";

vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
  default: { setTimeout: () => Promise.resolve() },
}));
afterEach(() => vi.restoreAllMocks());

describe("owned audit stack cleanup", () => {
  it("preserves setup failure and the logs path when cleanup also fails", async () => {
    const setupError = new Error("Synthetic setup failure");
    const cleanupError = new Error("Synthetic container failure");
    await expect(
      cleanupAuditStack(
        [],
        () => {
          throw cleanupError;
        },
        {
          error: setupError,
          logs: "/tmp/synthetic-audit-logs",
        },
      ),
    ).rejects.toMatchObject({
      message:
        "Audit stack setup and cleanup failed; see /tmp/synthetic-audit-logs",
      errors: [setupError, { errors: [cleanupError] }],
    });
  });

  it("attempts every process and container cleanup before reporting failures", async () => {
    const signalError = Object.assign(new Error("Synthetic signal failure"), {
      code: "EPERM",
    });
    const containerError = new Error("Synthetic container cleanup failure");
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === -11 && signal === "SIGTERM") throw signalError;
      return true;
    });
    const removeContainer = vi.fn(() => {
      throw containerError;
    });
    await expect(
      cleanupAuditStack([{ pid: 11 }, { pid: 22 }], removeContainer),
    ).rejects.toMatchObject({ errors: [signalError, containerError] });
    expect(kill.mock.calls).toEqual([
      [-11, "SIGTERM"],
      [-22, "SIGTERM"],
      [-11, "SIGKILL"],
      [-22, "SIGKILL"],
    ]);
    expect(removeContainer).toHaveBeenCalledOnce();
  });

  it("ignores already-exited process groups and still removes the container", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("Already exited"), { code: "ESRCH" });
    });
    const removeContainer = vi.fn();
    await cleanupAuditStack([{ pid: undefined }, { pid: 11 }], removeContainer);
    expect(kill.mock.calls).toEqual([[-11, "SIGTERM"]]);
    expect(removeContainer).toHaveBeenCalledOnce();
  });

  it("does not retry a vanished group ID that could have been reused", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === -11 && signal === "SIGTERM")
        throw Object.assign(new Error("Already exited"), { code: "ESRCH" });
      return true;
    });
    const removeContainer = vi.fn();
    await cleanupAuditStack([{ pid: 11 }, { pid: 22 }], removeContainer);
    expect(kill.mock.calls).toEqual([
      [-11, "SIGTERM"],
      [-22, "SIGTERM"],
      [-22, "SIGKILL"],
    ]);
    expect(removeContainer).toHaveBeenCalledOnce();
  });
});
