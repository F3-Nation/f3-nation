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

  it("accepts a bare array rule on an empty array, but not a deeper segment", async () => {
    // Zero elements mean a deeper segment was never evaluated: a renamed or
    // deleted field would be indistinguishable from a correct rule.
    await expect(
      normalize(jsonResponse({ items: [] }), { paths: { "items[]": "<X>" } }),
    ).resolves.toMatchObject({ body: { items: [] } });

    await expect(
      normalize(jsonResponse({ items: [] }), {
        paths: { "items[].id": "<ID>" },
      }),
    ).rejects.toThrow(/scrub path "items\[\]\.id" matched nothing/);
  });

  it("throws when a rule's shape no longer matches the body", async () => {
    // items[] where items stopped being an array
    await expect(
      normalize(jsonResponse({ items: { id: 1 } }), {
        paths: { "items[]": "<X>" },
      }),
    ).rejects.toThrow(/scrub path "items\[\]" matched nothing/);

    // a plain segment walked into an array
    await expect(
      normalize(jsonResponse({ a: [{ b: 1 }] }), { paths: { "a.b": "<X>" } }),
    ).rejects.toThrow(/scrub path "a\.b" matched nothing/);
  });

  it("reports status and a body snippet when JSON-labeled content is not JSON", async () => {
    const res = new Response("<html>oops</html>", {
      status: 502,
      headers: { "content-type": "application/problem+json" },
    });
    await expect(normalize(res)).rejects.toThrow(
      /502 claimed application\/problem\+json but the body is not JSON: <html>oops<\/html>/,
    );
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

  it("only matches string leaves — numbers, booleans and null pass through", async () => {
    // A rule keyed by a small number must never swallow unrelated counts or
    // ids that happen to share its digits.
    const golden = await normalize(
      jsonResponse({
        fixtureId: "7",
        unrelatedCount: 7,
        flag: true,
        gone: null,
      }),
      { values: { "7": "<FIXTURE_ID>", true: "<T>", null: "<N>" } },
    );
    expect(golden.body).toEqual({
      fixtureId: "<FIXTURE_ID>",
      unrelatedCount: 7,
      flag: true,
      gone: null,
    });
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
