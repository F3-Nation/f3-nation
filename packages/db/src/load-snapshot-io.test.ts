import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { copyFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  confirm,
  fetchToFile,
  mkTmp,
  rmTmp,
  readText,
  runProc,
} from "./load-snapshot-io";

const rl = vi.hoisted(() => ({
  question: vi.fn(() => Promise.resolve("yes")),
  close: vi.fn(),
}));
vi.mock("node:readline/promises", () => ({ createInterface: () => rl }));

describe("runProc", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const r = await runProc(process.execPath, [
      "-e",
      "console.log('out'); console.error('err'); process.exit(3)",
    ]);
    expect(r).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
  });

  it("feeds a file to stdin", async () => {
    const dir = await mkTmp();
    const file = path.join(dir, "in.txt");
    await writeFile(file, "hello");
    const r = await runProc(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      file,
    );
    expect(r).toMatchObject({ code: 0, stdout: "hello" });
    await rmTmp(dir);
  });

  it("reports a missing binary as exit 127 instead of throwing", async () => {
    const r = await runProc("definitely-not-a-binary-xyz", []);
    expect(r.code).toBe(127);
    expect(r.stderr).toMatch(/ENOENT/);
  });

  it("fails, and stops the child, when the stdin file can't be read", async () => {
    const dir = await mkTmp();
    const r = await runProc(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      path.join(dir, "missing.dump"),
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/ENOENT/);
    await rmTmp(dir);
  });

  it("tolerates a child that exits without reading stdin", async () => {
    const dir = await mkTmp();
    const file = path.join(dir, "big.txt");
    await writeFile(file, "x".repeat(5_000_000));
    const r = await runProc(process.execPath, ["-e", "process.exit(0)"], file);
    expect(r.code).toBe(0);
    await rmTmp(dir);
  });
});

describe("fetchToFile", () => {
  let base: string;
  const server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.setHeader("content-length", "5");
      res.end("hello");
    } else if (req.url === "/big") {
      res.end("x".repeat(100));
    } else if (req.url === "/redirect") {
      res.statusCode = 302;
      res.setHeader("location", "http://example.invalid/a.tar");
      res.end();
    } else if (req.url === "/stall") {
      res.write("partial");
    } else if (req.url === "/declared") {
      res.setHeader("content-length", "100");
      res.end("x".repeat(100));
    } else {
      res.statusCode = 404;
      res.end("no");
    }
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const dest = async () =>
    path.join(await mkdtemp(path.join(os.tmpdir(), "f3-io-test-")), "out");

  it("streams the body to disk", async () => {
    const out = await dest();
    await fetchToFile(new URL(`${base}/ok`), out);
    expect(await readFile(out, "utf8")).toBe("hello");
  });

  it("refuses to follow a redirect", async () => {
    await expect(
      fetchToFile(new URL(`${base}/redirect`), await dest()),
    ).rejects.toThrow(/Could not download the snapshot from 127\.0\.0\.1/);
  });

  it("names the host and --file when the connection fails, never the query", async () => {
    const err = await fetchToFile(
      new URL("http://127.0.0.1:1/x?token=secret"),
      await dest(),
    ).catch((e: Error) => e);
    expect((err as Error).message).toMatch(
      /Could not download the snapshot from 127\.0\.0\.1:1: .+--file/,
    );
    expect((err as Error).message).not.toContain("secret");
    expect((err as Error).cause).toBeInstanceOf(Error);
  });

  it("reports a timeout during the download", async () => {
    await expect(
      fetchToFile(new URL(`${base}/stall`), await dest(), { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out after 0 min/);
  });

  it("reports a local write failure with the same guidance", async () => {
    await expect(
      fetchToFile(new URL(`${base}/ok`), "/nonexistent-dir/out"),
    ).rejects.toThrow(/Could not download.*ENOENT/);
  });

  it("says the snapshot may not be published on a 404", async () => {
    await expect(
      fetchToFile(new URL(`${base}/missing`), await dest()),
    ).rejects.toThrow(/404.*published/);
  });

  it("refuses a declared size over the cap", async () => {
    await expect(
      fetchToFile(new URL(`${base}/declared`), await dest(), { maxBytes: 10 }),
    ).rejects.toThrow(/larger than/);
  });

  it("stops a body that grows past the cap", async () => {
    await expect(
      fetchToFile(new URL(`${base}/big`), await dest(), { maxBytes: 10 }),
    ).rejects.toThrow(/larger than/);
  });
});

describe("files and prompt", () => {
  it("makes, reads, copies and removes a temp dir", async () => {
    const dir = await mkTmp();
    await writeFile(path.join(dir, "a"), "data");
    await copyFile(path.join(dir, "a"), path.join(dir, "b"));
    expect(await readText(path.join(dir, "b"))).toBe("data");
    await rmTmp(dir);
    await expect(readText(path.join(dir, "a"))).rejects.toThrow();
  });

  it("readText refuses a file over the cap", async () => {
    const dir = await mkTmp();
    const file = path.join(dir, "big.json");
    await writeFile(file, "x".repeat(20));
    await expect(readText(file, 10)).rejects.toThrow(/larger than 10 bytes/);
    await expect(readText(file, 100)).resolves.toHaveLength(20);
    await rmTmp(dir);
  });

  it("mkTmp removes the dir and exits on SIGINT", async () => {
    const handlers: Record<string, (s: string) => void> = {};
    const once = vi.spyOn(process, "once").mockImplementation(((
      event: string,
      fn: (s: string) => void,
    ) => {
      handlers[event] = fn;
      return process;
    }) as never);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const dir = await mkTmp();
    expect(Object.keys(handlers).sort()).toEqual(["SIGINT", "SIGTERM"]);
    handlers.SIGINT?.("SIGINT");
    expect(exit).toHaveBeenCalledWith(130);
    await expect(readText(path.join(dir, "x"))).rejects.toThrow();
    await expect(stat(dir)).rejects.toThrow();
    once.mockRestore();
    exit.mockRestore();
  });

  it("confirm asks one question and closes the prompt", async () => {
    await expect(confirm("ok? ")).resolves.toBe("yes");
    expect(rl.question).toHaveBeenCalledWith("ok? ");
    expect(rl.close).toHaveBeenCalledOnce();
  });
});
