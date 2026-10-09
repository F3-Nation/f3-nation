import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { extend, spawn, docker, createServer } = vi.hoisted(() => ({
  extend: vi.fn((fixtures: Record<string, unknown>) => fixtures),
  spawn: vi.fn(),
  docker: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("@playwright/test", () => ({ test: { extend } }));
vi.mock("node:child_process", () => ({
  spawn,
  execFileSync: docker,
  default: { spawn, execFileSync: docker },
}));
vi.mock("node:net", () => ({ createServer, default: { createServer } }));
vi.mock("node:fs", () => {
  const fs = {
    mkdtempSync: () => "/tmp/synthetic-audit-logs",
    openSync: () => 12,
    closeSync: () => undefined,
  };
  return { ...fs, default: fs };
});
vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
  default: { setTimeout: () => Promise.resolve() },
}));

import "../tests/audit-stack";

type AuditStackFixture = (
  dependencies: object,
  provide: (stack: { databaseUrl: string; baseURL: string }) => Promise<void>,
) => Promise<void>;

const [auditStack] = extend.mock.calls[0]![0].auditStack as [AuditStackFixture];
let failedSetup: "migrate" | "seed" | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("E2E_AUDIT_LOCAL", "1");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  failedSetup = undefined;
  let nextPid = 11;
  spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      pid: nextPid++,
      exitCode: null as number | null,
      signalCode: null,
    });
    queueMicrotask(() => {
      child.emit("spawn");
      const command = args.at(-1);
      if (command === "migrate" || command === "seed:local") {
        child.exitCode =
          command === (failedSetup === "seed" ? "seed:local" : failedSetup)
            ? 1
            : 0;
        child.emit("exit", child.exitCode);
      }
    });
    return child;
  });
  docker.mockImplementation((_command: string, args: string[]) =>
    args[0] === "port" ? "127.0.0.1:15432" : "",
  );
  let nextPort = 15433;
  createServer.mockImplementation(() => {
    const port = nextPort++;
    return {
      once: vi.fn(),
      listen: (_port: number, _host: string, onListen: () => void) =>
        onListen(),
      address: () => ({ port }),
      close: (onClose: () => void) => onClose(),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectContainerRemoved() {
  expect(docker).toHaveBeenCalledWith(
    "docker",
    ["rm", "--force", expect.stringMatching(/^f3-audit-/)],
    expect.any(Object),
  );
}

describe("audit stack process ownership", () => {
  it("only tears down app groups, including descendants after their leader exits", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const provide = vi.fn().mockImplementation(() => {
      const api = spawn.mock.results[2]!.value as ChildProcess;
      Object.assign(api, { exitCode: 0 });
      api.emit("exit", 0, null);
      return Promise.resolve();
    });

    await auditStack({}, provide);

    expect(provide).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(kill.mock.calls).toEqual([
      [-13, "SIGTERM"],
      [-14, "SIGTERM"],
      [-13, "SIGKILL"],
      [-14, "SIGKILL"],
    ]);
    expectContainerRemoved();
  });

  it.each(["migrate", "seed"] as const)(
    "does not signal completed setup groups when %s fails",
    async (command) => {
      failedSetup = command;
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      const provide = vi.fn().mockResolvedValue(undefined);

      await expect(auditStack({}, provide)).rejects.toThrow(
        `${command} failed; see /tmp/synthetic-audit-logs`,
      );

      expect(provide).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledTimes(command === "migrate" ? 1 : 2);
      expectContainerRemoved();
    },
  );
});
