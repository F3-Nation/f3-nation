import type { Invoke } from "../transport";
import { app } from "../../src/app";

/**
 * In-process dispatch through `app.fetch`. It needs no pre-handler modeling
 * (trailing-slash 308, docs-route 405/OPTIONS) because `app.ts` implements
 * those itself, and no request-scope shim because session resolution is fully
 * header-based.
 */
export const invokeHono: Invoke = async (request) => app.fetch(request);
