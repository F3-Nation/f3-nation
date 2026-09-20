import { describe, expect, it } from "vitest";

import {
  renderOtpEmailHtml,
  renderOtpEmailText,
} from "~/app/api/otp/otp-email-template";

describe("renderOtpEmailHtml", () => {
  it("renders the token and host", () => {
    const html = renderOtpEmailHtml({
      token: "AB12CD",
      host: "map.f3nation.com",
    });

    expect(html).toContain("AB12CD");
    expect(html).toContain("map&#8203;.f3nation&#8203;.com");
  });

  it("escapes HTML in the token", () => {
    const html = renderOtpEmailHtml({
      token: "<img src=x onerror=alert(1)>",
      host: "map.f3nation.com",
    });

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("escapes ampersands and quotes in the token", () => {
    const html = renderOtpEmailHtml({
      token: `a&b"c'd`,
      host: "map.f3nation.com",
    });

    expect(html).toContain("a&amp;b&quot;c&#39;d");
  });

  it("escapes HTML-significant characters that are valid in a URL host", () => {
    const html = renderOtpEmailHtml({
      token: "AB12CD",
      host: `a&b"c'd.example`,
    });

    expect(html).toContain("a&amp;b&quot;c&#39;d&#8203;.example");
  });
});

describe("renderOtpEmailText", () => {
  it("renders the plain-text body", () => {
    expect(
      renderOtpEmailText({ token: "AB12CD", host: "map.f3nation.com" }),
    ).toBe(
      "Sign in to map.f3nation.com in your browser with this code: AB12CD\n",
    );
  });
});
