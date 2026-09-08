import type { Invoke } from "../transport";
import { app } from "../../src/app";

/**
 * Unlike `targets/next.ts`, this needs no pre-handler modeling (trailing-slash
 * 308, docs-route 405/OPTIONS synthesis) — `app.ts` implements those itself, so
 * a divergence there fails a golden instead of being silently duplicated here.
 * It also needs no `next/headers` shim: session resolution is fully
 * header-based, so `app.fetch` receiving a real `Request` is enough.
 */
export const invokeHono: Invoke = async (request) => app.fetch(request);
