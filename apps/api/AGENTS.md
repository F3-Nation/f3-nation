# apps/api

Hono on `@hono/node-server`, bundled with esbuild (`scripts/build.mjs`); the
oRPC router lives in `packages/api`. `pnpm dev` runs it with
`NODE_ENV=development` and `ALLOW_DEV_MOCK_SESSION=true` so the dev mock
session works locally (see the README's "Dev mock session").

`characterization/` goldens are frozen: a snapshot diff is a behavior change,
not churn. Read [docs/testing.md](../../docs/testing.md) before touching them.
