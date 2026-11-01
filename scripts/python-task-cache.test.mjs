import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  chmodSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const turbo = join(dirname(require.resolve("turbo/package.json")), "bin/turbo");
const packageDirs = ["apps/analytics", "apps/slackbot", "packages/db-python"];

test("Python checks re-evaluate tool availability without changing PATH or source", () => {
  const temp = mkdtempSync(join(tmpdir(), "python-cache-test-"));
  const repo = join(temp, "repo");
  const bin = join(temp, "bin");
  const marker = join(temp, "executed");
  try {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(bin);
    const lookup = (name) => {
      const result = spawnSync("which", [name], { encoding: "utf8" });
      assert.equal(result.status, 0, `Required executable: ${name}`);
      return result.stdout.trim();
    };
    // pnpm shell launchers need these utilities even on the restricted PATH.
    for (const name of [
      "bash",
      "sh",
      "pnpm",
      "readlink",
      "dirname",
      "sed",
      "uname",
    ])
      symlinkSync(lookup(name), join(bin, name));
    symlinkSync(process.execPath, join(bin, "node"));
    copyFileSync(join(root, "turbo.json"), join(repo, "turbo.json"));
    copyFileSync(
      join(root, "scripts/python-task.sh"),
      join(repo, "scripts/python-task.sh"),
    );
    const packageManager = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ).packageManager;
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({
        name: "python-cache-fixture",
        private: true,
        packageManager,
      }),
    );
    writeFileSync(
      join(repo, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n  - packages/*\n",
    );
    writeFileSync(join(repo, ".gitignore"), ".turbo/\nnode_modules/\n");
    let lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
    const tasks = [];
    for (const dir of packageDirs) {
      const original = JSON.parse(
        readFileSync(join(root, dir, "package.json"), "utf8"),
      );
      const scripts = {};
      for (const [task, command] of Object.entries(original.scripts)) {
        if (!command.includes("scripts/python-task.sh")) continue;
        tasks.push(`${original.name}:${task}`);
        scripts[task] =
          `bash ../../scripts/python-task.sh ${task} ${original.name} uv ${original.name}:${task}`;
      }
      mkdirSync(join(repo, dir), { recursive: true });
      writeFileSync(
        join(repo, dir, "package.json"),
        JSON.stringify({ name: original.name, private: true, scripts }),
      );
      lock += `  ${dir}: {}\n`;
    }
    mkdirSync(join(repo, "packages/control"));
    writeFileSync(
      join(repo, "packages/control/package.json"),
      JSON.stringify({
        name: "cache-control",
        scripts: {
          format: "node -e \"process.stdout.write('CONTROL_EXECUTED')\"",
        },
      }),
    );
    lock += "  packages/control: {}\n";
    writeFileSync(join(repo, "pnpm-lock.yaml"), lock);
    for (const args of [
      ["init", "-q"],
      ["add", "."],
    ]) {
      const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const env = {
      PATH: bin,
      HOME: process.env.HOME,
      CI: "",
      TURBO_TELEMETRY_DISABLED: "1",
      COREPACK_ENABLE_NETWORK: "0",
    };
    const run = (overrides = {}) => {
      const result = spawnSync(
        process.execPath,
        [
          turbo,
          "run",
          "format",
          "lint",
          "test",
          "typecheck",
          "--cache=local:rw",
          "--concurrency=1",
          "--continue=always",
        ],
        {
          cwd: repo,
          env: { ...env, ...overrides },
          encoding: "utf8",
          timeout: 60000,
        },
      );
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    };
    const absent = run();
    assert.equal(absent.status, 0, absent.output);
    assert.equal(
      (absent.output.match(/Skipping /g) ?? []).length,
      tasks.length,
      absent.output,
    );
    // Only the executable changes; it lives outside the hashed workspace.
    writeFileSync(
      join(bin, "uv"),
      `#!/bin/sh\nprintf '%s\\n' "$1" >> '${marker}'\nexit 17\n`,
    );
    chmodSync(join(bin, "uv"), 0o755);
    const available = run();
    assert.notEqual(
      available.status,
      0,
      "Newly available checks must run and expose their failures.\n" +
        available.output,
    );
    assert.deepEqual(
      readFileSync(marker, "utf8").trim().split("\n").sort(),
      tasks.sort(),
    );
    assert.match(
      available.output,
      /cache-control:format: cache hit/,
      available.output,
    );
    unlinkSync(join(bin, "uv"));
    const ci = run({ CI: "true" });
    assert.notEqual(ci.status, 0, ci.output);
    assert.equal(
      (ci.output.match(/refusing to skip/g) ?? []).length,
      tasks.length,
      ci.output,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
