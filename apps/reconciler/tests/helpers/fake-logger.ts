import { vi } from "vitest";

import type { Logger } from "../../src/logging.js";

export function createFakeLogger(): Logger & {
  infoCalls: unknown[][];
  warnCalls: unknown[][];
  errorCalls: unknown[][];
  criticalCalls: unknown[][];
  driftCalls: unknown[][];
  stuckOperationCalls: unknown[][];
  certRenewalCalls: unknown[][];
} {
  const infoCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const criticalCalls: unknown[][] = [];
  const driftCalls: unknown[][] = [];
  const stuckOperationCalls: unknown[][] = [];
  const certRenewalCalls: unknown[][] = [];
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
    critical: vi.fn((...args: unknown[]) => {
      criticalCalls.push(args);
    }),
    drift: vi.fn((...args: unknown[]) => {
      driftCalls.push(args);
    }),
    stuckOperation: vi.fn((...args: unknown[]) => {
      stuckOperationCalls.push(args);
    }),
    certRenewal: vi.fn((...args: unknown[]) => {
      certRenewalCalls.push(args);
    }),
    infoCalls,
    warnCalls,
    errorCalls,
    criticalCalls,
    driftCalls,
    stuckOperationCalls,
    certRenewalCalls,
  };
}
