<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Logo uploads go through `@acme/storage` as the Cloud Run service's own
identity, never a stored key; the service account and its bucket and secret
grants are set up per
[`docs/GCP_APP_SETUP.md`](../../docs/GCP_APP_SETUP.md#4-create-runtime-service-accounts-and-cloud-run-services),
and the auth modes are in [`packages/storage/README.md`](../../packages/storage/README.md).

Auth proxy (`proxy.ts`) and session changes follow
[`apps/auth/AGENTS.md` § Security rules](../auth/AGENTS.md#security-rules).
