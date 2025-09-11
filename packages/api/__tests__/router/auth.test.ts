import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { appRouter } from "../../src/index";

describe("auth router", () => {
  const createTRPCContext = () => {
    return {
      session: {
        user: {
          id: "test-id",
        },
      },
    };
  };
  const t = initTRPC.context<typeof createTRPCContext>().create();
  // @ts-expect-error, we skip typechecking due to testing context only
  const createCaller = t.createCallerFactory(appRouter);
  const caller = createCaller(createTRPCContext());

  it("should getSession", async () => {
    const result = await caller.auth.getSession();
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });

  it("should getSecretMessage", async () => {
    const result = await caller.auth.getSecretMessage();
    expect(result).toBe("you can see this secret message!");
  });
});
