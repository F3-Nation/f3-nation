import { describe, expect, it } from "vitest";

import {
  getTrustedClientIp,
  TRUSTED_PROXY_HOPS,
} from "@acme/shared/common/client-ip";

const xff = (value: string) => new Headers({ "x-forwarded-for": value });

describe("getTrustedClientIp", () => {
  it("trusts exactly the one hop Cloud Run appends by default", () => {
    expect(TRUSTED_PROXY_HOPS).toBe(1);
    expect(getTrustedClientIp(xff("198.51.100.7"))).toBe("198.51.100.7");
  });

  it("ignores caller-supplied entries left of the trusted hop", () => {
    // A caller rotating a forged prefix must land in the same bucket.
    for (const forged of ["9.9.9.9", "1.2.3.4, 5.6.7.8", "not-an-ip", "::1"]) {
      expect(getTrustedClientIp(xff(`${forged}, 198.51.100.7`))).toBe(
        "198.51.100.7",
      );
    }
  });

  it("counts back N hops when N proxies are trusted (e.g. behind a load balancer)", () => {
    // forged, client (appended by the LB), LB (appended by Cloud Run)
    expect(
      getTrustedClientIp(xff("9.9.9.9, 198.51.100.7, 35.191.0.1"), 2),
    ).toBe("198.51.100.7");
  });

  it("uses the leftmost entry when the chain is shorter than the trusted hop count", () => {
    expect(getTrustedClientIp(xff("198.51.100.7"), 2)).toBe("198.51.100.7");
  });

  it("floors trustedHops at 1, so 0 still reads the rightmost entry", () => {
    expect(getTrustedClientIp(xff("9.9.9.9, 198.51.100.7"), 0)).toBe(
      "198.51.100.7",
    );
    expect(getTrustedClientIp(xff("9.9.9.9, 198.51.100.7"), -3)).toBe(
      "198.51.100.7",
    );
  });

  it("returns the rightmost non-empty entry when the header ends in a comma", () => {
    expect(getTrustedClientIp(xff("198.51.100.7, "))).toBe("198.51.100.7");
  });

  it("trims whitespace and skips empty entries", () => {
    expect(getTrustedClientIp(xff(" 9.9.9.9 ,, 198.51.100.7 , "))).toBe(
      "198.51.100.7",
    );
  });

  it("returns null when there is no usable x-forwarded-for (local dev)", () => {
    expect(getTrustedClientIp(new Headers())).toBeNull();
    expect(getTrustedClientIp(xff(" , "))).toBeNull();
    expect(getTrustedClientIp(xff(","))).toBeNull();
    expect(getTrustedClientIp(null)).toBeNull();
    expect(getTrustedClientIp(undefined)).toBeNull();
  });
});
