/**
 * Test utilities for API router tests
 *
 * The framework-agnostic fixtures live in ../testing so consumers outside
 * vitest (the apps/api characterization suite) can reuse them; they are
 * re-exported here so existing test files need no changes. Only helpers that
 * genuinely require vitest belong in this file.
 */

import type { Session } from "@acme/auth";
import { createRouterClient } from "@orpc/server";
import { vi } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";
import { router } from "../index";

export * from "../testing";

/**
 * Creates a test client for the router
 */
export const createTestClient = () => {
  return createRouterClient(router, {
    context: () => ({
      reqHeaders: new Headers({
        [Header.Client]: Client.ORPC,
      }),
    }),
  });
};

/**
 * Sets up the auth mock with a specific session
 */
export const mockAuthWithSession = async (session: Session | null) => {
  const { auth } = await import("@acme/auth");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  vi.mocked(auth as any).mockResolvedValue(session);
};
