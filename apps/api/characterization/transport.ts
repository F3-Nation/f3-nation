import { invokeHono } from "./targets/hono";
import { makeLiveInvoke } from "./targets/live";

export type Invoke = (request: Request) => Promise<Response>;

const TARGET_KINDS = ["hono", "live"] as const;
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
  /**
   * True when fixtures written by this process are visible to the target: it
   * dispatches in-process, or it is a server booted against this process's
   * database (CI's bundle leg, which opts in with CHAR_TEST_SHARED_DB=1).
   */
  sharesDatabase: boolean;
  invoke: Invoke;
  baseUrl: string;
}

function resolveTarget(): ResolvedTarget {
  const raw = process.env.CHAR_TEST_TARGET ?? "hono";
  if (!isTargetKind(raw)) {
    throw new Error(`Unknown CHAR_TEST_TARGET: ${raw}`);
  }
  const kind = raw;

  if (kind === "live") {
    const baseUrl = process.env.CHAR_TEST_BASE_URL;
    if (!baseUrl) {
      throw new Error("CHAR_TEST_TARGET=live requires CHAR_TEST_BASE_URL");
    }
    return {
      kind,
      inProcess: false,
      sharesDatabase: process.env.CHAR_TEST_SHARED_DB === "1",
      invoke: makeLiveInvoke(baseUrl),
      baseUrl,
    };
  }

  return {
    kind,
    inProcess: true,
    sharesDatabase: true,
    invoke: invokeHono,
    baseUrl: CHAR_BASE,
  };
}

export const target = resolveTarget();

/** Build a request against the active target's origin. */
export function req(path: string, init?: RequestInit): Request {
  return new Request(new URL(path, target.baseUrl), init);
}
