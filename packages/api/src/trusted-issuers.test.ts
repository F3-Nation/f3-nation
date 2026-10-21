import { describe, expect, it } from "vitest";

import { parseAdditionalIssuers, trustedIssuers } from "./trusted-issuers";

describe("parseAdditionalIssuers", () => {
  it.each([undefined, "", " ", " , ,"])("is empty for %j", (raw) => {
    expect(parseAdditionalIssuers(raw)).toEqual([]);
  });

  it("trims, drops empty entries, normalizes to the origin and dedupes", () => {
    expect(
      parseAdditionalIssuers(
        " https://staging.auth3.f3nation.com , ,https://staging.auth3.f3nation.com/,https://auth3.f3nation.com",
      ),
    ).toEqual([
      "https://staging.auth3.f3nation.com",
      "https://auth3.f3nation.com",
    ]);
  });

  it("allows http only for localhost and 127.0.0.1", () => {
    expect(
      parseAdditionalIssuers("http://localhost:3005,http://127.0.0.1:3006"),
    ).toEqual(["http://localhost:3005", "http://127.0.0.1:3006"]);
    expect(() => parseAdditionalIssuers("http://auth3.f3nation.com")).toThrow(
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
    expect(() =>
      parseAdditionalIssuers(`https://ok.example.test,${entry}`),
    ).toThrow(message);
    expect(() => parseAdditionalIssuers(entry)).toThrow(
      /Invalid AUTH_ADDITIONAL_ISSUERS entry/,
    );
  });
});

describe("trustedIssuers", () => {
  it("is just the primary issuer, verbatim, when nothing else is set", () => {
    expect(trustedIssuers("https://auth.f3nation.com", undefined)).toEqual([
      "https://auth.f3nation.com",
    ]);
    // The primary is not normalized, so its exact `iss` match is unchanged.
    expect(trustedIssuers("https://auth.f3nation.com/", "")).toEqual([
      "https://auth.f3nation.com/",
    ]);
  });

  it("lists the primary first and drops an additional entry repeating it", () => {
    expect(
      trustedIssuers(
        "https://auth.f3nation.com",
        "https://auth3.f3nation.com,https://auth.f3nation.com",
      ),
    ).toEqual(["https://auth.f3nation.com", "https://auth3.f3nation.com"]);
  });

  it("is empty with neither set, and additional-only without a primary", () => {
    expect(trustedIssuers(undefined, undefined)).toEqual([]);
    expect(trustedIssuers("", "https://auth3.f3nation.com")).toEqual([
      "https://auth3.f3nation.com",
    ]);
  });
});
