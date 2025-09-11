import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { appRouter } from "../../src/index";

describe("ping router", () => {
  const createTRPCContext = () => {
    return {};
  };
  const t = initTRPC.context<typeof createTRPCContext>().create();
  // @ts-expect-error, we skip typechecking due to testing context only
  const createCaller = t.createCallerFactory(appRouter);
  const caller = createCaller(createTRPCContext());

  it("should ping", async () => {
    const result = await caller.ping();
    expect(result.alive).toBe(true);
    expect(result.timestamp).toBeInstanceOf(Date);
  });
});
