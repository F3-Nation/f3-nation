import { describe, expect, it } from "vitest";

import { trustedIssuers } from "./trusted-issuers";

describe("trustedIssuers", () => {
  it.each([undefined, "", " ", " , ,"])("is empty for %j", (raw) => {
    expect(trustedIssuers(raw)).toEqual([]);
  });

  it("trims, drops empty entries, normalizes to the origin and dedupes", () => {
    expect(
      trustedIssuers(
        " https://staging.auth3.f3nation.com , ,https://staging.auth3.f3nation.com/,https://auth3.f3nation.com",
      ),
    ).toEqual([
      "https://staging.auth3.f3nation.com",
      "https://auth3.f3nation.com",
    ]);
  });

  it("allows http only for localhost and 127.0.0.1", () => {
    expect(
      trustedIssuers("http://localhost:3005,http://127.0.0.1:3006"),
    ).toEqual(["http://localhost:3005", "http://127.0.0.1:3006"]);
    expect(() => trustedIssuers("http://auth3.f3nation.com")).toThrow(
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
    expect(() => trustedIssuers(`https://ok.example.test,${entry}`)).toThrow(
      message,
    );
    expect(() => trustedIssuers(entry)).toThrow(
      /Invalid AUTH_TRUSTED_ISSUERS entry/,
    );
  });
});
