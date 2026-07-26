import { describe, expect, it } from "vitest";

import { stableStringify } from "../normalize";
import { req, target } from "../transport";

describe("OpenAPI document", () => {
  it("matches the committed golden", async () => {
    // The route (apps/api/src/app/docs/openapi.json/route.ts) prefers
    // `NEXT_PUBLIC_API_URL` over any derivation from the host header, and
    // that env var is REQUIRED by packages/env's schema (z.string().min(1))
    // — deleting it, as the plan predicted, throws in env validation instead
    // of falling back to the host header. global-setup.ts already pins it to
    // this same synthetic origin for the whole suite (so `servers[0].url` is
    // identical across developers and targets), so no unset/restore dance is
    // needed here; the host header below is inert but kept for documentation
    // of intent.
    const res = await target.invoke(
      req("/docs/openapi.json", {
        headers: {
          host: "api.characterization.test",
          "x-forwarded-for": "10.94.0.1",
        },
      }),
    );
    expect(res.status).toBe(200);

    const spec = (await res.json()) as { info: { version: string } };
    // Release Please bumps this every release; the version is not behavior.
    spec.info.version = "0.0.0-characterization";

    await expect(stableStringify(spec)).toMatchFileSnapshot(
      "../__snapshots__/openapi.golden.json",
    );
  });

  it("serves the document with no credentials", async () => {
    // #660's ADR follow-up: "the docs stay public" becomes CI-enforced on both
    // transports rather than a promise.
    const res = await target.invoke(
      req("/docs/openapi.json", {
        headers: { "x-forwarded-for": "10.94.0.2" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
