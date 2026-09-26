import { spawn, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtempSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test as base } from "@playwright/test";

import { cleanupAuditStack } from "./audit-cleanup";

// This fixture owns every target. It never connects to E2E_BASE_URL or a supplied
// database URL. Docker allocates an isolated database; fresh Next processes get
// that exact URL. No reuseExistingServer or fallback to an occupied port.
const image =
  "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280";
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local port allocated");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export const test = base.extend<
  object,
  { auditStack: { databaseUrl: string; baseURL: string } }
>({
  baseURL: async ({ auditStack }, provide) => provide(auditStack.baseURL),
  auditStack: [
    async ({}, provide) => {
      if (process.env.E2E_AUDIT_LOCAL !== "1")
        throw new Error("Audit E2E requires its disposable local fixture");
      const root = resolve(import.meta.dirname, "../../..");
      const container = `f3-audit-${randomUUID()}`;
      const logs = mkdtempSync(join(tmpdir(), "f3-audit-e2e-"));
      const children: ChildProcess[] = [];
      let containerCreated = false;
      const docker = (...args: string[]) =>
        execFileSync("docker", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      try {
        // Trust auth is confined to this short-lived container on a loopback port.
        docker(
          "run",
          "--detach",
          "--rm",
          "--name",
          container,
          "--publish",
          "127.0.0.1::5432",
          "--env",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          "--env",
          "POSTGRES_DB=audit_e2e_test",
          image,
        );
        containerCreated = true;
        const binding = docker("port", container, "5432/tcp");
        if (!/^127\.0\.0\.1:\d+$/.test(binding))
          throw new Error("Unexpected Docker port binding");
        const databaseUrl = `postgresql://postgres@${binding}/audit_e2e_test`;
        let ready = false;
        for (let i = 0; i < 60; i++) {
          try {
            docker(
              "exec",
              container,
              "pg_isready",
              "-U",
              "postgres",
              "-d",
              "audit_e2e_test",
            );
            ready = true;
            break;
          } catch {
            await delay(500);
          }
        }
        if (!ready) throw new Error("Disposable PostgreSQL did not start");
        const mapPort = await freePort();
        let apiPort = await freePort();
        while (apiPort === mapPort) apiPort = await freePort();
        const baseURL = `http://127.0.0.1:${mapPort}`;
        const apiURL = `http://127.0.0.1:${apiPort}`;
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          NODE_ENV: "development",
          CI: "",
          DATABASE_URL: databaseUrl,
          TEST_DATABASE_URL: databaseUrl,
          NEXT_PUBLIC_CHANNEL: "local",
          NEXT_PUBLIC_MAP_URL: baseURL,
          NEXT_PUBLIC_API_URL: apiURL,
          F3_API_BASE_URL: apiURL,
          NEXT_PUBLIC_ADMIN_URL: baseURL,
          NEXTAUTH_URL: baseURL,
          AUTH_URL: baseURL,
          NEXT_PUBLIC_POSTHOG_KEY: "",
          NEXT_PUBLIC_POSTHOG_SESSION_RECORDING: "false",
          SKIP_ENV_VALIDATION: "1",
        };
        async function start(name: string, args: string[], wait: boolean) {
          const fd = openSync(join(logs, `${name}.log`), "w", 0o600);
          const child = spawn("pnpm", args, {
            cwd: root,
            env,
            detached: true,
            stdio: ["ignore", fd, fd],
          });
          closeSync(fd);
          children.push(child);
          await new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            if (!wait) child.once("spawn", resolve);
            else
              child.once("exit", (code) =>
                code === 0
                  ? resolve()
                  : reject(new Error(`${name} failed; see ${logs}`)),
              );
          });
          return child;
        }
        await start("migrate", ["--filter", "@acme/db", "migrate"], true);
        await start("seed", ["--filter", "@acme/db", "seed:local"], true);
        const api = await start(
          "api",
          [
            "--filter",
            "f3-api",
            "with-env",
            "next",
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(apiPort),
          ],
          false,
        );
        const map = await start(
          "map",
          [
            "--filter",
            "f3-map",
            "with-env",
            "next",
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(mapPort),
          ],
          false,
        );
        for (const [child, url] of [
          [api, `${apiURL}/v1/ping`],
          [map, `${baseURL}/api/auth/csrf`],
        ] as const) {
          ready = false;
          for (let i = 0; i < 120; i++) {
            if (child.exitCode !== null || child.signalCode !== null)
              throw new Error(`Owned app server exited; see ${logs}`);
            try {
              const response = await fetch(url, {
                signal: AbortSignal.timeout(2000),
                redirect: "error",
              });
              if (response.ok) {
                ready = true;
                break;
              }
            } catch {
              /* Next may still be compiling; process exit and deadline are checked. */
            }
            await delay(500);
          }
          if (!ready)
            throw new Error(
              `Owned app server did not become ready; see ${logs}`,
            );
        }
        await provide({ databaseUrl, baseURL });
      } finally {
        await cleanupAuditStack(children, () => {
          if (containerCreated) docker("rm", "--force", container);
        });
      }
    },
    { scope: "worker", timeout: 300000 },
  ],
});
