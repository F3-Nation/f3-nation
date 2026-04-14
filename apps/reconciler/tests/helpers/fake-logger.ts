import { vi } from "vitest";

import type { Logger } from "../../src/logging.js";

export function createFakeLogger(): Logger & {
  infoCalls: unknown[][];
  warnCalls: unknown[][];
  errorCalls: unknown[][];
  driftCalls: unknown[][];
} {
  const infoCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const driftCalls: unknown[][] = [];
  return {
    info: vi.fn((...args: unknown[]) => {
      infoCalls.push(args);
    }),
    warn: vi.fn((...args: unknown[]) => {
      warnCalls.push(args);
    }),
    error: vi.fn((...args: unknown[]) => {
      errorCalls.push(args);
    }),
    critical: vi.fn(),
    drift: vi.fn((...args: unknown[]) => {
      driftCalls.push(args);
    }),
    stuckOperation: vi.fn(),
    certRenewal: vi.fn(),
    infoCalls,
    warnCalls,
    errorCalls,
    driftCalls,
  };
}
