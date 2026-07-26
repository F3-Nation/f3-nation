import { describe, expect, it } from "vitest";

import { normalize, stableStringify } from "./normalize";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-noise": "ignored" },
  });
}

describe("normalize", () => {
  it("keeps only allow-listed headers", async () => {
    const golden = await normalize(jsonResponse({ ok: true }));
    expect(golden.headers).toEqual({ "content-type": "application/json" });
  });

  it("parses a JSON body and passes text through unchanged", async () => {
    expect((await normalize(jsonResponse({ ok: true }))).body).toEqual({
      ok: true,
    });

    const text = new Response("Not found", { status: 404 });
    const golden = await normalize(text);
    expect(golden).toMatchObject({ status: 404, body: "Not found" });
  });

  it("replaces values at dotted paths, including through arrays", async () => {
    const golden = await normalize(
      jsonResponse({
        timestamp: "2026-07-26T00:00:00.000Z",
        items: [{ id: 11 }, { id: 12 }],
      }),
      { paths: { timestamp: "<TIMESTAMP>", "items[].id": "<ID>" } },
    );

    expect(golden.body).toEqual({
      timestamp: "<TIMESTAMP>",
      items: [{ id: "<ID>" }, { id: "<ID>" }],
    });
  });

  it("throws when a path rule matches nothing", async () => {
    await expect(
      normalize(jsonResponse({ ok: true }), { paths: { missing: "<X>" } }),
    ).rejects.toThrow(/scrub path "missing" matched nothing/);
  });

  it("replaces known values anywhere in the body", async () => {
    const golden = await normalize(
      jsonResponse({ nested: { key: "abc123" } }),
      {
        values: { abc123: "<KEY>" },
      },
    );
    expect(golden.body).toEqual({ nested: { key: "<KEY>" } });
  });

  it("does not throw for an unused value rule", async () => {
    // Unlike path rules, value rules are opportunistic: a fixture id that
    // simply does not appear in this response is not a defect.
    await expect(
      normalize(jsonResponse({ ok: true }), { values: { nope: "<X>" } }),
    ).resolves.toMatchObject({ body: { ok: true } });
  });
});

describe("stableStringify", () => {
  it("sorts keys recursively so goldens diff on behavior, not ordering", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(stableStringify({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });
});
