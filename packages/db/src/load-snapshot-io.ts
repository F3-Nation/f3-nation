/**
 * The real effects behind load-snapshot-lib.ts's `LoadDeps`: child processes
 * (never through a shell), a size- and time-capped download, and a prompt.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";

import type { ProcResult } from "./load-snapshot-lib";

const MAX_BYTES = 2 * 1024 ** 3;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_TEXT_BYTES = 1024 * 1024;

/** Run `cmd` with an argv array; stdin comes from `stdinFile` when given. */
export function runProc(
  cmd: string,
  args: string[],
  stdinFile?: string,
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: [stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) =>
      resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (stdinFile && child.stdin) {
      // The child may exit before reading all of it (e.g. a bad archive).
      child.stdin.on("error", () => undefined);
      createReadStream(stdinFile)
        .on("error", (err) => {
          child.kill();
          resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` });
        })
        .pipe(child.stdin);
    }
  });
}

/** Why a download failed, without the URL (a signed one could carry a token). */
const downloadError = (url: URL, err: unknown, timeoutMs: number) => {
  const why =
    err instanceof Error && err.name === "TimeoutError"
      ? `timed out after ${Math.round(timeoutMs / 60_000)} min`
      : err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error
          ? err.message
          : String(err);
  return new Error(
    `Could not download the snapshot from ${url.host}: ${why}. Check your network, or load a local copy with --file.`,
    { cause: err },
  );
};

export async function fetchToFile(
  url: URL,
  dest: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetch(url, {
      // validateSourceUrl vetted this URL only; a redirect could leave https.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw downloadError(url, err, timeoutMs);
  }
  if (!res.ok || !res.body) {
    throw new Error(
      `Download failed: ${res.status} ${res.statusText}. Has the snapshot been published yet? (--file loads a local one.)`,
    );
  }
  const max = opts.maxBytes ?? MAX_BYTES;
  const tooLarge = `Snapshot is larger than ${max} bytes`;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error(tooLarge);
  let seen = 0;
  const capped = Readable.fromWeb(res.body as ReadableStream).on(
    "data",
    (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > max) capped.destroy(new Error(tooLarge));
    },
  );
  try {
    await pipeline(capped, createWriteStream(dest));
  } catch (err) {
    if (err instanceof Error && err.message === tooLarge) throw err;
    throw downloadError(url, err, timeoutMs);
  }
}

export async function confirm(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** A fresh temp dir that is also removed on Ctrl-C or SIGTERM. */
export async function mkTmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "f3-snapshot-"));
  const cleanup = (signal: NodeJS.Signals) => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  return dir;
}

/** Reads a small text file (the manifest), refusing anything larger than `maxBytes`. */
export async function readText(
  file: string,
  maxBytes = MAX_TEXT_BYTES,
): Promise<string> {
  if ((await stat(file)).size > maxBytes) {
    throw new Error(`${path.basename(file)} is larger than ${maxBytes} bytes`);
  }
  return readFile(file, "utf8");
}

export const rmTmp = (dir: string) => rm(dir, { recursive: true, force: true });
