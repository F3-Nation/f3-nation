// Boots the built server bundle and asserts it serves, then shuts down
// cleanly. Run by the Dockerfile's smoke stage from a directory holding
// dist/ (with its runtime node_modules) and public/, laid out exactly as the
// runner stage lays them out, so the image cannot ship a bundle that fails
// at module evaluation, is missing an external, or 404s its static asset.

import { spawn } from "node:child_process";

const PORT = "8089";
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;

const server = spawn(
  process.execPath,
  ["--import", "./dist/instrument.js", "./dist/server.js"],
  { env: { ...process.env, PORT }, stdio: "inherit" },
);

let exited = false;
/** @type {Promise<number | NodeJS.Signals | null>} */
const exitCode = new Promise((resolve) => {
  server.on("exit", (code, signal) => {
    exited = true;
    resolve(code ?? signal);
  });
});

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`smoke: FAIL ${message}`);
  server.kill("SIGKILL");
  process.exit(1);
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) fail("server exited during startup");
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`server not ready within ${READY_TIMEOUT_MS}ms`);
}

/**
 * @param {Response} res
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonObject(res) {
  const parsed = /** @type {unknown} */ (await res.json());
  if (typeof parsed !== "object" || parsed === null) {
    fail(`${res.url} did not return a JSON object`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {string} path
 * @returns {Promise<Response>}
 */
async function expectOk(path) {
  const res = await fetch(`${BASE}${path}`);
  if (res.status !== 200) fail(`GET ${path} returned ${res.status}`);
  console.log(`smoke: ok GET ${path}`);
  return res;
}

await waitForReady();

const health = await expectOk("/health");
if (health.headers.get("cache-control") !== "no-store") {
  fail("GET /health is missing Cache-Control: no-store");
}
const healthBody = await readJsonObject(health);
if (healthBody.service !== "f3-api") {
  fail(`GET /health reported service ${JSON.stringify(healthBody.service)}`);
}

const spec = await readJsonObject(await expectOk("/docs/openapi.json"));
if (typeof spec.openapi !== "string") {
  fail("GET /docs/openapi.json is not an OpenAPI document");
}

await expectOk("/favicon.ico");

server.kill("SIGTERM");
const code = await exitCode;
if (code !== 0) fail(`server exited with ${String(code)} after SIGTERM`);
console.log("smoke: ok SIGTERM shutdown");
