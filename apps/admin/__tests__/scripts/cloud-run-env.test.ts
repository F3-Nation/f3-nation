// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/cloud-run-env.sh", import.meta.url),
);

const RUNTIME_SA = "cloudrun-f3-admin@example.invalid";
const SECRET_IDS = [
  "NEXT_PUBLIC_GOOGLE_API_KEY",
  "OAUTH_CLIENT_SECRET",
  "PROXY_CLIENT_IP_SECRET",
];

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Runs the script against a fake gcloud that records its arguments (never
 * stdin, which carries secret values) and reports every secret as existing.
 */
function runScript(fail: { describe?: boolean; binding?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "admin-cloud-run-env-"));
  try {
    const app = join(root, "apps", "admin");
    const bin = join(root, "bin");
    const callsFile = join(root, "gcloud-calls.jsonl");
    const recorder = join(root, "record-gcloud.mjs");
    mkdirSync(join(app, "scripts"), { recursive: true });
    mkdirSync(bin);
    copyFileSync(SCRIPT, join(app, "scripts", "cloud-run-env.sh"));
    writeFileSync(
      join(app, ".env.cloud-run.staging"),
      [
        "F3_GOOGLE_API_KEY='synthetic-google-key'",
        "OAUTH_CLIENT_SECRET='synthetic-oauth-secret'",
        `PROXY_CLIENT_IP_SECRET='${"synthetic-proxy-secret-".padEnd(32, "x")}'`,
        "F3_CHANNEL='staging'",
        "",
      ].join("\n"),
    );
    writeFileSync(
      recorder,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + "\\n");
const cmd = args.slice(0, 3).join(" ");
if (cmd === "run services describe") {
  if (${JSON.stringify(Boolean(fail.describe))}) process.exit(1);
  process.stdout.write(${JSON.stringify(RUNTIME_SA + "\n")});
}
if (cmd.startsWith("secrets add-iam-policy-binding") && ${JSON.stringify(Boolean(fail.binding))}) {
  process.exit(1);
}
`,
    );
    writeFileSync(
      join(bin, "gcloud"),
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(recorder)} "$@"\n`,
      { mode: 0o755 },
    );

    const result = spawnSync(
      "bash",
      [join(app, "scripts", "cloud-run-env.sh"), "--env", "staging"],
      {
        env: {
          NODE_ENV: "test",
          HOME: root,
          PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          LC_ALL: "C",
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    const calls = existsSync(callsFile)
      ? readFileSync(callsFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const bindings = (calls: string[][]) =>
  calls.filter(
    (args) => args[0] === "secrets" && args[1] === "add-iam-policy-binding",
  );
const serviceUpdates = (calls: string[][]) =>
  calls.filter((args) => args.slice(0, 3).join(" ") === "run services update");

describe("admin cloud-run-env.sh", () => {
  beforeAll(() => {
    const probe = spawnSync("bash", ["-c", "echo ${BASH_VERSINFO[0]}"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const major = Number(probe.error ? "" : probe.stdout.trim());
    if (probe.status !== 0 || !Number.isInteger(major) || major < 4) {
      throw new Error(
        "cloud-run-env tests need Bash 4+ first on PATH; see docs/LOCAL_DEV_DOCKER.md#bash-for-deployment-helper-tests",
      );
    }
  });

  it("grants the runtime account every secret, including ones that already exist", () => {
    const { status, calls } = runScript();

    expect(status).toBe(0);
    const granted = bindings(calls);
    expect(granted.map((args) => args[2]).sort()).toEqual(SECRET_IDS);
    for (const args of granted) {
      expect(args).toContain(`serviceAccount:${RUNTIME_SA}`);
      expect(args).toContain("roles/secretmanager.secretAccessor");
    }
    expect(serviceUpdates(calls)).toHaveLength(1);
  });

  it("stops before the service update when a grant fails", () => {
    const { status, output, calls } = runScript({ binding: true });

    expect(status).not.toBe(0);
    expect(output).toContain("Aborting before the service update");
    expect(serviceUpdates(calls)).toHaveLength(0);
  });

  it("stops before any grant when the runtime account can't be read", () => {
    const { status, output, calls } = runScript({ describe: true });

    expect(status).not.toBe(0);
    expect(output).toContain("Couldn't read the runtime service account");
    expect(bindings(calls)).toHaveLength(0);
    expect(serviceUpdates(calls)).toHaveLength(0);
    expect(
      calls.some((args) => args.slice(0, 2).join(" ") === "projects describe"),
    ).toBe(false);
  });
});
