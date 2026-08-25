// Delegates to the framework-neutral generator in ~/docs (moved there for the
// Hono migration, phase 2 / #649). This file stays only because Next's
// file-system router still needs it — it's what actually deploys until phase
// 3+4 cuts over.
export { openApiJson as GET } from "~/docs";
