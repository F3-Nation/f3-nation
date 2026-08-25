// Delegates to the framework-neutral handler in ~/handler (moved there for the
// Hono migration, phase 2 / #649). This file stays only because Next's
// file-system router still needs it — it's what actually deploys until phase
// 3+4 cuts over.
import { handleRequest } from "~/handler";

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const OPTIONS = handleRequest; // Important for CORS preflight!
