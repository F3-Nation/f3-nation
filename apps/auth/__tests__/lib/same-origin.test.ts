import { describe, expect, it } from "vitest";

import { rejectCrossSiteWrite } from "../../src/lib/same-origin";

const URL_ = "https://auth.f3nation.com/api/onboarding";

function request(headers: Record<string, string>): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { host: "auth.f3nation.com", ...headers },
  });
}

describe("rejectCrossSiteWrite", () => {
  it.each(["same-origin", "none"])("allows Sec-Fetch-Site: %s", (site) => {
    expect(
      rejectCrossSiteWrite(request({ "sec-fetch-site": site })),
    ).toBeNull();
  });

  it.each(["cross-site", "same-site"])(
    "rejects Sec-Fetch-Site: %s with a 403",
    async (site) => {
      const res = rejectCrossSiteWrite(
        request({
          "sec-fetch-site": site,
          // A matching Origin can't override what the browser reported.
          origin: "https://auth.f3nation.com",
        }),
      );

      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ error: "cross_site_request" });
    },
  );

  it("falls back to comparing Origin with Host when Sec-Fetch-Site is absent", () => {
    expect(
      rejectCrossSiteWrite(request({ origin: "https://auth.f3nation.com" })),
    ).toBeNull();
    expect(
      rejectCrossSiteWrite(request({ origin: "https://evil.example" }))?.status,
    ).toBe(403);
  });

  it("rejects an opaque or unparseable Origin", () => {
    expect(rejectCrossSiteWrite(request({ origin: "null" }))?.status).toBe(403);
  });

  it("allows a request with neither header, which a browser never sends", () => {
    expect(rejectCrossSiteWrite(request({}))).toBeNull();
  });

  describe("with requireJson", () => {
    const sameOrigin = { "sec-fetch-site": "same-origin" };

    it("allows an application/json body, with or without a charset", () => {
      for (const type of [
        "application/json",
        "application/json; charset=utf-8",
        "Application/JSON",
      ]) {
        expect(
          rejectCrossSiteWrite(
            request({ ...sameOrigin, "content-type": type }),
            { requireJson: true },
          ),
        ).toBeNull();
      }
    });

    it.each([
      ["text/plain", "text/plain;charset=UTF-8"],
      ["a form body", "application/x-www-form-urlencoded"],
      ["a multipart body", "multipart/form-data; boundary=x"],
      ["a look-alike type", "application/jsonp"],
    ])("rejects %s with a 415", async (_name, type) => {
      const res = rejectCrossSiteWrite(
        request({ ...sameOrigin, "content-type": type }),
        { requireJson: true },
      );

      expect(res?.status).toBe(415);
      expect(await res?.json()).toEqual({
        error: "Content-Type must be application/json",
      });
    });

    it("rejects a missing Content-Type", () => {
      expect(
        rejectCrossSiteWrite(request(sameOrigin), { requireJson: true })
          ?.status,
      ).toBe(415);
    });

    it("checks the origin before the content type", () => {
      expect(
        rejectCrossSiteWrite(
          request({
            "sec-fetch-site": "cross-site",
            "content-type": "application/json",
          }),
          { requireJson: true },
        )?.status,
      ).toBe(403);
    });
  });
});
