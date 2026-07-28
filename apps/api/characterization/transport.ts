import { makeLiveInvoke } from "./targets/live";
import { invokeNext } from "./targets/next";

export type Invoke = (request: Request) => Promise<Response>;

const TARGET_KINDS = ["next", "hono", "live"] as const;
type TargetKind = (typeof TARGET_KINDS)[number];

function isTargetKind(value: string): value is TargetKind {
  return (TARGET_KINDS as readonly string[]).includes(value);
}

/** Stable synthetic origin so goldens never encode a real host or port. */
const CHAR_BASE = "http://api.characterization.test";

interface ResolvedTarget {
  kind: TargetKind;
  /** True when dispatch runs in this process (DB fixtures are reachable). */
  inProcess: boolean;
  invoke: Invoke;
  baseUrl: string;
}

function resolveTarget(): ResolvedTarget {
  const raw = process.env.CHAR_TEST_TARGET ?? "next";
  if (!isTargetKind(raw)) {
    throw new Error(`Unknown CHAR_TEST_TARGET: ${raw}`);
  }
  const kind = raw;

  if (kind === "next") {
    return { kind, inProcess: true, invoke: invokeNext, baseUrl: CHAR_BASE };
  }

  if (kind === "live") {
    const baseUrl = process.env.CHAR_TEST_BASE_URL;
    if (!baseUrl) {
      throw new Error("CHAR_TEST_TARGET=live requires CHAR_TEST_BASE_URL");
    }
    return { kind, inProcess: false, invoke: makeLiveInvoke(baseUrl), baseUrl };
  }

  // kind === "hono": filled in when the Hono entry point lands. Kept as an
  // explicit branch so the union and the inProcess gates are already in place.
  throw new Error(
    "CHAR_TEST_TARGET=hono is not wired up until the Hono server lands",
  );
}

export const target = resolveTarget();

/** Build a request against the active target's origin. */
export function req(path: string, init?: RequestInit): Request {
  return new Request(new URL(path, target.baseUrl), init);
}
