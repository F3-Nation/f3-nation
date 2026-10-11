/**
 * Child processes and output for staging-refresh.ts and its snapshot mode
 * (staging-refresh.snapshot.ts). stdin is always ignored: a child must never
 * read the orchestrator's stdin.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { libpqEnv } from "./db-url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, "..");

export function log(line = ""): void {
  console.log(line);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string[];
  /** stderr ran past the lines kept in `stderr`. */
  stderrTruncated: boolean;
}

export function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"]) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

// Server messages that quote row values (a failing row, a duplicate key, the
// COPY line). The data is obfuscated by then, but free text outside the
// prose columns is only scrubbed (docs/STAGING_REFRESH.md): keep it out of
// the job's logs.
const ROW_DATA =
  /Failing row contains|^\s*CONTEXT:\s+COPY .* line \d+|^\s*DETAIL:\s+Key \(/;

export function run(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; cwd?: string; quietStderr?: RegExp },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const stderr: string[] = [];
    let stderrTruncated = false;
    createInterface({ input: child.stdout }).on("line", (line) => {
      stdout += `${line}\n`;
      log(`   | ${line}`);
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      if (stderr.length < 5000) stderr.push(line);
      else stderrTruncated = true;
      if (ROW_DATA.test(line)) log("   ! [row data withheld from the log]");
      else if (!opts.quietStderr?.test(line)) log(`   ! ${line}`);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr, stderrTruncated }),
    );
  });
}

const PG_BIN_DIR = process.env.PG_BIN_DIR ?? "";
const pgBin = (tool: string) =>
  PG_BIN_DIR ? path.join(PG_BIN_DIR, tool) : tool;

/** pg_dump / pg_restore with credentials in the environment, never argv. */
export async function pgTool(
  tool: "pg_dump" | "pg_restore",
  args: string[],
  url: string,
  opts: { pgoptions?: string; benignError?: RegExp; quietStderr?: RegExp } = {},
): Promise<void> {
  const env: Record<string, string> = {
    ...baseEnv(),
    ...libpqEnv(url),
    PGCONNECT_TIMEOUT: "30",
  };
  if (opts.pgoptions) env.PGOPTIONS = opts.pgoptions;
  const result = await run(pgBin(tool), args, {
    env,
    quietStderr: opts.quietStderr,
  });
  if (result.code === 0) return;
  // Errors past the kept lines can't be judged benign.
  if (result.stderrTruncated) {
    throw new Error(
      `${tool} exited with ${result.code} after more stderr than was kept`,
    );
  }
  // pg_restore exits 1 when it "ignored" errors. Only the expected ones are
  // allowed through (e.g. `schema "auth" already exists` on the copy).
  const errors = result.stderr.filter((l) => /\berror:/.test(l));
  const real = errors.filter((l) => !opts.benignError?.test(l));
  if (opts.benignError && errors.length > 0 && real.length === 0) {
    log(`   ${tool}: ${errors.length} expected error(s) ignored`);
    return;
  }
  throw new Error(
    `${tool} exited with ${result.code}: ${(real.length > 0 ? real : result.stderr).slice(0, 5).join(" / ")}`,
  );
}

/** One of this package's scripts, against `databaseUrl`. */
export async function runScript(
  script: string,
  args: string[],
  databaseUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  // Children get only the database they work on: never the other URLs.
  const env = {
    ...baseEnv(),
    SKIP_ENV_VALIDATION: "1",
    DATABASE_URL: databaseUrl,
    ...extraEnv,
  };
  return run(
    process.execPath,
    ["--import", "tsx", path.join(HERE, `${script}.ts`), ...args],
    { env, cwd: SCRIPTS_DIR },
  );
}

export function pgMajor(tool: string): number | undefined {
  const out = spawnSync(pgBin(tool), ["--version"], { encoding: "utf8" });
  const m = /\(PostgreSQL\) (\d+)/.exec(out.stdout);
  return m ? Number(m[1]) : undefined;
}

/** An access token for the Cloud Run job's service account. */
export async function metadataToken(): Promise<string> {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
  const { access_token: token } = (await res.json()) as {
    access_token: string;
  };
  return token;
}
