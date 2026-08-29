import { describe, expect, it } from "vitest";

import { stableStringify } from "../normalize";
import { req, target } from "../transport";

describe("OpenAPI document", () => {
  it("matches the committed golden", async () => {
    // The route (apps/api/src/app/docs/openapi.json/route.ts) prefers
    // `NEXT_PUBLIC_API_URL` over any derivation from the host header, and
    // that env var is required by packages/env's schema (z.string().min(1)),
    // so deleting it — as the plan predicted — throws in env validation
    // locally rather than falling back to the host header. (In CI it would
    // not: `skipValidation` is keyed off CI=true.) global-setup.ts already
    // pins it to this same synthetic origin for the whole suite, so
    // `servers[0].url` is identical across developers and no unset/restore
    // dance is needed here; the host header below is inert but kept for
    // documentation of intent.
    const res = await target.invoke(
      req("/docs/openapi.json", {
        headers: {
          host: "api.characterization.test",
          "x-forwarded-for": "10.94.0.1",
        },
      }),
    );
    expect(res.status).toBe(200);

    const spec = (await res.json()) as {
      info: { version: string };
      servers: { url: string }[];
    };
    // Release Please bumps this every release; the version is not behavior.
    spec.info.version = "0.0.0-characterization";
    // Only the `next`/`hono` targets see global-setup.ts's
    // NEXT_PUBLIC_API_URL; a remote `live` server derives this from its own
    // host, so pin a placeholder rather than the synthetic test origin.
    spec.servers = spec.servers.map((server) => ({
      ...server,
      url: "<API_URL>",
    }));

    await expect(stableStringify(spec)).toMatchFileSnapshot(
      "../__snapshots__/openapi.golden.json",
    );
  });

  it("ignores credentials entirely — even an invalid one is served", async () => {
    // #660's ADR follow-up: "the docs stay public" becomes CI-enforced on both
    // transports rather than a promise. A garbage credential discriminates a
    // route that IGNORES auth from one that merely tolerates its absence: a
    // port that mounts the docs behind the auth middleware would still 200 an
    // anonymous request's sibling test above, but 401s this one.
    const res = await target.invoke(
      req("/docs/openapi.json", {
        headers: {
          authorization: "Bearer not-a-real-token",
          "x-forwarded-for": "10.94.0.2",
        },
      }),
    );
    expect(res.status).toBe(200);
    // The route neither demands nor establishes a session.
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
