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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface Channels {
  F3_CHANNEL?: string;
  NEXT_PUBLIC_CHANNEL?: string;
}

function runScript(
  target: "prod" | "staging",
  channels: Channels,
  parentChannels: Channels = {},
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
        ...(["F3_CHANNEL", "NEXT_PUBLIC_CHANNEL"] as const).flatMap((name) => {
          const value = channels[name];
          return value === undefined ? [] : [`${name}=${shellQuote(value)}`];
        }),
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
        ...parentChannels,
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

describe("cloud-run-env channel guards", () => {
  beforeAll(() => {
    const probe = spawnSync("bash", ["-c", "echo ${BASH_VERSINFO[0]}"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const version = probe.error ? "" : probe.stdout.trim();
    const major = Number(version);
    if (
      probe.error ||
      probe.status !== 0 ||
      probe.signal !== null ||
      !Number.isInteger(major) ||
      major < 4
    ) {
      const found = Number.isInteger(major) && major > 0 ? major : "none";
      throw new Error(
        `cloud-run-env tests need Bash 4+ first on PATH (found ${found}); see docs/LOCAL_DEV_DOCKER.md#bash-for-deployment-helper-tests`,
      );
    }
  });

  it.each(["prod", "staging"] as const)(
    "allows matching %s configuration to update the intended service",
    (target) => {
      const result = runScript(target, {
        F3_CHANNEL: target,
        NEXT_PUBLIC_CHANNEL: target,
      });
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
      expect(update?.[update.indexOf("--update-env-vars") + 1]).toBe(
        `^::^NODE_ENV=production::F3_CHANNEL=${target}::NEXT_PUBLIC_CHANNEL=${target}`,
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
      const result = runScript(target, {
        F3_CHANNEL: channel,
        NEXT_PUBLIC_CHANNEL: channel,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("F3_CHANNEL");
      expect(result.calls).toEqual([]);
    },
  );

  it.each(["prod", "staging"] as const)(
    "requires %s in the file even when the parent environment matches",
    (target) => {
      const result = runScript(
        target,
        {},
        { F3_CHANNEL: target, NEXT_PUBLIC_CHANNEL: target },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("F3_CHANNEL");
      expect(result.calls).toEqual([]);
    },
  );

  it.each(["prod", "staging"] as const)(
    "uses the %s file instead of an inherited channel",
    (target) => {
      const inherited = target === "prod" ? "staging" : "prod";
      const result = runScript(
        target,
        { F3_CHANNEL: target, NEXT_PUBLIC_CHANNEL: target },
        { F3_CHANNEL: inherited, NEXT_PUBLIC_CHANNEL: inherited },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const update = result.calls.find(
        (args) => args.slice(0, 3).join(" ") === "run services update",
      );
      expect(update).toBeDefined();
      expect(update?.[update.indexOf("--update-env-vars") + 1]).toBe(
        `^::^NODE_ENV=production::F3_CHANNEL=${target}::NEXT_PUBLIC_CHANNEL=${target}`,
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
    "rejects target %s with NEXT_PUBLIC_CHANNEL %s before any cloud command",
    (target, channel) => {
      const result = runScript(target, {
        F3_CHANNEL: target,
        NEXT_PUBLIC_CHANNEL: channel,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("NEXT_PUBLIC_CHANNEL");
      expect(result.calls).toEqual([]);
    },
  );

  it.each(["prod", "staging"] as const)(
    "requires NEXT_PUBLIC_CHANNEL=%s in the file even when the parent matches",
    (target) => {
      const result = runScript(
        target,
        { F3_CHANNEL: target },
        { NEXT_PUBLIC_CHANNEL: target },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("NEXT_PUBLIC_CHANNEL");
      expect(result.calls).toEqual([]);
    },
  );

  it("does not echo an unexpected public channel value in rejection output", () => {
    const unexpected = "synthetic-public-value-that-must-not-be-printed";
    const result = runScript("prod", {
      F3_CHANNEL: "prod",
      NEXT_PUBLIC_CHANNEL: unexpected,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_CHANNEL");
    expect(result.stdout + result.stderr).not.toContain(unexpected);
    expect(result.calls).toEqual([]);
  });

  it("does not echo an unexpected channel value in rejection output", () => {
    const unexpected = "synthetic-value-that-must-not-be-printed";
    const result = runScript("prod", {
      F3_CHANNEL: unexpected,
      NEXT_PUBLIC_CHANNEL: "prod",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("F3_CHANNEL");
    expect(result.stdout + result.stderr).not.toContain(unexpected);
    expect(result.calls).toEqual([]);
  });
});
