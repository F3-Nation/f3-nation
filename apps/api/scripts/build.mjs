// Bundles the Hono server entry (src/server.ts) into dist/ with esbuild.
//
// Why bundle rather than `pnpm --filter f3-api --prod deploy` + tsx:
// `pnpm deploy` applies `publishConfig`, which
// would resolve @f3nation/health to ./dist/index.js. The root AGENTS.md is
// explicit that those dist artifacts are not guaranteed to exist before a
// consumer resolves the package. esbuild reads its source entrypoint instead
// and sidesteps the ordering problem entirely.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoRoot = resolve(appDir, "../..");
const outDir = join(appDir, "dist");

/**
 * Left to Node's own resolution at runtime rather than inlined.
 *
 * `pino`/`pino-pretty` because pino-pretty drives a `thread-stream` worker,
 * which spawns from a real file path a bundle cannot provide; `@sentry/node`
 * because its OpenTelemetry auto-instrumentation patches modules through
 * `import-in-the-middle`, which only works on modules Node resolves itself;
 * and `postgres` for the same reason as `@sentry/node` — its dedicated
 * `postgresJsIntegration` only fires if `postgres` is still a real module
 * resolution Node performs, not code inlined into the bundle. Without this,
 * DB spans silently stop appearing in Sentry (queries still work; only the
 * tracing data is lost).
 * `thread-stream` never appears in the graph once pino is external; it is listed
 * so a future direct import cannot silently get inlined.
 */
const EXTERNAL = [
  "pino",
  "pino-pretty",
  "thread-stream",
  "@sentry/node",
  "postgres",
];

/**
 * Shipped in the generated runtime package.json, resolved from the workspace
 * package that actually depends on each one. `thread-stream` is deliberately
 * absent: it arrives as pino's own dependency.
 *
 * @type {Record<string, string>}
 */
const RUNTIME_DEPS = {
  pino: join(repoRoot, "packages/logger"),
  "pino-pretty": join(repoRoot, "packages/logger"),
  "@sentry/node": appDir,
  postgres: join(repoRoot, "packages/db"),
};

/**
 * JSON.parse is typed `any`, which the repo's type-aware lint rules reject.
 * Narrow once here so every caller works with a known shape.
 *
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readManifest(path) {
  const parsed = /** @type {unknown} */ (
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} field
 * @param {string} path
 * @returns {string}
 */
function readManifestString(manifest, field, path) {
  const value = manifest[field];
  if (typeof value !== "string") {
    throw new Error(`${path} has no string "${field}"`);
  }
  return value;
}

/**
 * Walks node_modules upward rather than using `require.resolve`, which throws
 * on packages whose `exports` map does not expose ./package.json.
 *
 * @param {string} name
 * @param {string} startDir
 * @returns {string}
 */
function resolveInstalledVersion(name, startDir) {
  let dir = startDir;
  for (;;) {
    try {
      const manifest = readManifest(
        join(dir, "node_modules", name, "package.json"),
      );
      const version = manifest.version;
      if (typeof version !== "string") {
        throw new Error(
          `${join(dir, "node_modules", name, "package.json")} has no string "version"`,
        );
      }
      return version;
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      // Not installed at this level; keep walking up.
    }
    if (dir === repoRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Cannot resolve an installed version of "${name}" under ${repoRoot}. ` +
      `It is externalized from the bundle, so the runtime package.json must ` +
      `pin it or the container fails at startup with ERR_MODULE_NOT_FOUND.`,
  );
}

const nodeTarget = `node${readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim()}`;

rmSync(outDir, { recursive: true, force: true });

await esbuild.build({
  // instrument.ts is a separate output so the container can preload it
  // (`node --import ./dist/instrument.js dist/server.js`). Sentry's
  // OpenTelemetry hooks must register before Node resolves the modules they
  // patch, which an in-file import cannot achieve — see the comment in
  // src/instrument.ts. `splitting` keeps the two outputs sharing one copy of
  // every common module: without it each would carry its own @acme/logger
  // instance, and instrument.ts's setErrorReporter() would configure a logger
  // that server.ts never uses.
  entryPoints: [
    join(appDir, "src/instrument.ts"),
    join(appDir, "src/server.ts"),
  ],
  outdir: outDir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: nodeTarget,
  external: EXTERNAL,
  tsconfig: join(appDir, "tsconfig.json"),
  sourcemap: true,
  logLevel: "info",
  // esbuild emits ESM but faithfully wraps the CJS it inlines — and CJS's
  // ambient `require`/`__filename`/`__dirname` are scope variables, not
  // imports, so they simply vanish. next/dist/compiled/ua-parser-js (reached
  // via next-auth -> next/server) dereferences __dirname at module scope, so
  // without this the process dies with a ReferenceError before it ever
  // listens. Not boilerplate; do not remove.
  banner: {
    js: [
      `import { createRequire as __createRequire } from "node:module";`,
      `import { fileURLToPath as __fileURLToPath } from "node:url";`,
      `import { dirname as __pathDirname } from "node:path";`,
      `const require = __createRequire(import.meta.url);`,
      `const __filename = __fileURLToPath(import.meta.url);`,
      `const __dirname = __pathDirname(__filename);`,
    ].join("\n"),
  },
});

/**
 * Sorted so the generated manifest is byte-stable across machines, which keeps
 * the Docker layer that installs from it cacheable.
 *
 * @type {Record<string, string>}
 */
const runtimeDependencies = {};
for (const name of Object.keys(RUNTIME_DEPS).sort()) {
  runtimeDependencies[name] = resolveInstalledVersion(name, RUNTIME_DEPS[name]);
}

const appManifestPath = join(appDir, "package.json");
const appManifest = readManifest(appManifestPath);

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "package.json"),
  JSON.stringify(
    {
      name: readManifestString(appManifest, "name", appManifestPath),
      version: readManifestString(appManifest, "version", appManifestPath),
      private: true,
      type: "module",
      dependencies: runtimeDependencies,
    },
    null,
    2,
  ) + "\n",
);

console.log(`Wrote ${join(outDir, "package.json")}`);
