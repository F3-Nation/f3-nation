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
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/cloud-run-env.sh", import.meta.url),
);

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runScript(
  target: "prod" | "staging",
  channel: string | undefined,
  parentChannel?: string,
) {
  const root = mkdtempSync(join(tmpdir(), "map-cloud-run-env-"));
  try {
    const app = join(root, "apps", "map");
    const script = join(app, "scripts", "cloud-run-env.sh");
    const bin = join(root, "bin");
    const callsFile = join(root, "gcloud-calls.jsonl");
    const recorder = join(root, "record-gcloud.mjs");
    mkdirSync(join(app, "scripts"), { recursive: true });
    mkdirSync(bin);
    copyFileSync(SCRIPT, script);
    writeFileSync(
      join(app, `.env.cloud-run.${target}`),
      [
        "API_KEY='synthetic-test-value'",
        ...(channel === undefined ? [] : [`F3_CHANNEL=${shellQuote(channel)}`]),
        "",
      ].join("\n"),
    );

    // The fake shadows gcloud on the child's PATH. Record arguments, never
    // stdin (which can contain secret values in the real deployment script).
    writeFileSync(
      recorder,
      `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + "\\n");
if (args.slice(0, 3).join(" ") === "run services describe") {
  process.stdout.write("test-runtime@example.invalid\\n");
}
`,
    );
    writeFileSync(
      join(bin, "gcloud"),
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(recorder)} "$@"\n`,
      { mode: 0o755 },
    );

    const result = spawnSync("bash", [script, "--env", target], {
      cwd: root,
      env: {
        NODE_ENV: "test",
        HOME: root,
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        LC_ALL: "C",
        ...(parentChannel === undefined ? {} : { F3_CHANNEL: parentChannel }),
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    const calls = existsSync(callsFile)
      ? readFileSync(callsFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
    return { ...result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("cloud-run-env F3_CHANNEL guard", () => {
  it.each(["prod", "staging"] as const)(
    "allows matching %s configuration to update the intended service",
    (target) => {
      const result = runScript(target, target);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const update = result.calls.find(
        (args) => args.slice(0, 3).join(" ") === "run services update",
      );
      expect(update).toBeDefined();
      expect(update).toContain("f3-map");
      expect(update?.[update.indexOf("--project") + 1]).toBe(
        target === "prod" ? "f3-map-app" : "f3-map-app-staging",
      );
      expect(update?.[update.indexOf("--update-env-vars") + 1]).toContain(
        `F3_CHANNEL=${target}`,
      );
    },
  );

  it.each([
    ["prod", "staging"],
    ["staging", "prod"],
    ["prod", undefined],
    ["staging", undefined],
    ["prod", ""],
    ["staging", ""],
    ["prod", "development"],
    ["staging", "development"],
    ["prod", " prod "],
    ["staging", " staging "],
    ["prod", "PROD"],
    ["staging", "STAGING"],
  ] as const)(
    "rejects target %s with channel %s before any cloud command",
    (target, channel) => {
      const result = runScript(target, channel);
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("F3_CHANNEL");
      expect(result.calls).toEqual([]);
    },
  );

  it.each(["prod", "staging"] as const)(
    "requires %s in the file even when the parent environment matches",
    (target) => {
      const result = runScript(target, undefined, target);
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("F3_CHANNEL");
      expect(result.calls).toEqual([]);
    },
  );

  it.each(["prod", "staging"] as const)(
    "uses the %s file instead of an inherited channel",
    (target) => {
      const result = runScript(
        target,
        target,
        target === "prod" ? "staging" : "prod",
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(
        result.calls.some((args) => args.includes("--update-env-vars")),
      ).toBe(true);
    },
  );

  it("does not echo an unexpected channel value in rejection output", () => {
    const unexpected = "synthetic-value-that-must-not-be-printed";
    const result = runScript("prod", unexpected);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("F3_CHANNEL");
    expect(result.stdout + result.stderr).not.toContain(unexpected);
    expect(result.calls).toEqual([]);
  });
});
