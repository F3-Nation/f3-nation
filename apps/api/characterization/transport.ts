import { makeLiveInvoke } from "./targets/live";
import { invokeNext } from "./targets/next";

export type Invoke = (request: Request) => Promise<Response>;
export type TargetKind = "next" | "hono" | "live";

/** Stable synthetic origin so goldens never encode a real host or port. */
const CHAR_BASE = "http://api.characterization.test";

function resolveTarget(): {
  kind: TargetKind;
  invoke: Invoke;
  baseUrl: string;
} {
  const kind = (process.env.CHAR_TEST_TARGET ?? "next") as TargetKind;

  if (kind === "next") {
    return { kind, invoke: invokeNext, baseUrl: CHAR_BASE };
  }

  if (kind === "live") {
    const baseUrl = process.env.CHAR_TEST_BASE_URL;
    if (!baseUrl) {
      throw new Error("CHAR_TEST_TARGET=live requires CHAR_TEST_BASE_URL");
    }
    return { kind, invoke: makeLiveInvoke(baseUrl), baseUrl };
  }

  if (kind === "hono") {
    // Filled in by #649, which adds the Hono entry point. Kept as an explicit
    // branch so the union and the runIf gates are already in place.
    throw new Error(
      "CHAR_TEST_TARGET=hono is not wired up until the Hono server lands (#649)",
    );
  }

  throw new Error(`Unknown CHAR_TEST_TARGET: ${String(kind)}`);
}

export const target = resolveTarget();

/** Build a request against the active target's origin. */
export function req(path: string, init?: RequestInit): Request {
  return new Request(new URL(path, target.baseUrl), init);
}
