import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HELPER = fileURLToPath(
  new URL("../../scripts/lib/gcloud-env-vars.sh", import.meta.url),
);

// Runs the helper the way the cloud-run-env scripts do: sourced, then called
// in an assignment under `set -e`. No gcloud or GCP credentials involved.
function joinEnvVars(delim: string, entries: string[]) {
  const res = spawnSync(
    "bash",
    [
      "-c",
      'set -euo pipefail; source "$0"; out="$(join_env_vars "$@")"; printf "%s" "$out"',
      HELPER,
      delim,
      ...entries,
    ],
    { encoding: "utf8" },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe("join_env_vars", () => {
  it("keeps a comma inside a value as part of that value", () => {
    const { status, stdout } = joinEnvVars("|", [
      "EMAIL_FROM=Team, F3 <support@example.com>",
      "NODE_ENV=production",
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      "^|^EMAIL_FROM=Team, F3 <support@example.com>|NODE_ENV=production",
    );
  });

  it("joins values without commas", () => {
    const { status, stdout } = joinEnvVars("|", [
      "NEXT_PUBLIC_AUTH_URL=https://auth.f3nation.com",
      "NODE_ENV=production",
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      "^|^NEXT_PUBLIC_AUTH_URL=https://auth.f3nation.com|NODE_ENV=production",
    );
  });

  it("fails and names the variable when a value contains the delimiter", () => {
    const { status, stdout, stderr } = joinEnvVars("|", [
      "NODE_ENV=production",
      "EMAIL_FROM=a|b <x@example.com>",
    ]);
    expect(status).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("EMAIL_FROM");
  });

  it("rejects a delimiter that is not exactly one character", () => {
    const { status, stdout, stderr } = joinEnvVars("::", ["A=1", "B=2"]);
    expect(status).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("single character");
  });
});
