import { describe, expect, it } from "vitest";

import { parseIssuerList, trustedIssuers } from "./trusted-issuers";

describe("parseIssuerList", () => {
  it.each([undefined, "", " ", " , ,"])("is empty for %j", (raw) => {
    expect(parseIssuerList(raw)).toEqual([]);
  });

  it("trims, drops empty entries, normalizes to the origin and dedupes", () => {
    expect(
      parseIssuerList(
        " https://staging.auth3.f3nation.com , ,https://staging.auth3.f3nation.com/,https://auth3.f3nation.com",
      ),
    ).toEqual([
      "https://staging.auth3.f3nation.com",
      "https://auth3.f3nation.com",
    ]);
  });

  it("allows http only for localhost and 127.0.0.1", () => {
    expect(
      parseIssuerList("http://localhost:3005,http://127.0.0.1:3006"),
    ).toEqual(["http://localhost:3005", "http://127.0.0.1:3006"]);
    expect(() => parseIssuerList("http://auth3.f3nation.com")).toThrow(
      /must use https/,
    );
  });

  it.each([
    ["not a url", /not a URL/],
    ["auth3.f3nation.com", /not a URL/],
    ["ftp://auth3.f3nation.com", /must use https/],
    ["https://auth3.f3nation.com/issuer", /bare origin/],
    ["https://auth3.f3nation.com?x=1", /bare origin/],
    ["https://auth3.f3nation.com#x", /bare origin/],
    ["https://user:pw@auth3.f3nation.com", /bare origin/],
  ])("throws for the malformed entry %j", (entry, message) => {
    expect(() => parseIssuerList(`https://ok.example.test,${entry}`)).toThrow(
      message,
    );
    expect(() => parseIssuerList(entry)).toThrow(
      /Invalid AUTH_TRUSTED_ISSUERS entry/,
    );
  });
});

describe("trustedIssuers", () => {
  it("is just the fallback issuer, verbatim, when the list is unset or empty", () => {
    expect(trustedIssuers(undefined, "https://auth.f3nation.com")).toEqual([
      "https://auth.f3nation.com",
    ]);
    // The fallback is not normalized, so its exact `iss` match is unchanged.
    expect(trustedIssuers(" , ", "https://auth.f3nation.com/")).toEqual([
      "https://auth.f3nation.com/",
    ]);
  });

  it("uses the list alone when it names any issuer, ignoring the fallback", () => {
    expect(
      trustedIssuers(
        "https://auth.f3nation.com,https://auth3.f3nation.com",
        "https://auth2.f3nation.com",
      ),
    ).toEqual(["https://auth.f3nation.com", "https://auth3.f3nation.com"]);
  });

  it("is empty with neither set, and the list alone without a fallback", () => {
    expect(trustedIssuers(undefined, undefined)).toEqual([]);
    expect(trustedIssuers("https://auth3.f3nation.com", "")).toEqual([
      "https://auth3.f3nation.com",
    ]);
  });
});
