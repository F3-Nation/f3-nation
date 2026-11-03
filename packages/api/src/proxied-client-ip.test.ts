import { describe, expect, it } from "vitest";

import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
} from "@acme/shared/common/client-ip";

import { getProxiedClientIp } from "./proxied-client-ip";

const secret = "s".repeat(32);

const proxied = (clientIp: string, presented: string) =>
  new Headers({
    [PROXY_CLIENT_IP_HEADER]: clientIp,
    [PROXY_SECRET_HEADER]: presented,
  });

describe("getProxiedClientIp", () => {
  it("returns the reported client IP when the secret matches", () => {
    expect(getProxiedClientIp(proxied(" 198.51.100.7 ", secret), secret)).toBe(
      "198.51.100.7",
    );
  });

  it("rejects a wrong secret, including one of a different length", () => {
    expect(
      getProxiedClientIp(proxied("198.51.100.7", "t".repeat(32)), secret),
    ).toBeNull();
    expect(getProxiedClientIp(proxied("198.51.100.7", "s"), secret)).toBeNull();
  });

  it("trusts nothing when the API has no secret configured", () => {
    expect(getProxiedClientIp(proxied("198.51.100.7", ""), undefined)).toBe(
      null,
    );
    expect(getProxiedClientIp(proxied("198.51.100.7", secret), "")).toBeNull();
  });

  it("returns null when either header is missing or empty", () => {
    expect(
      getProxiedClientIp(
        new Headers({ [PROXY_SECRET_HEADER]: secret }),
        secret,
      ),
    ).toBeNull();
    expect(
      getProxiedClientIp(
        new Headers({ [PROXY_CLIENT_IP_HEADER]: "198.51.100.7" }),
        secret,
      ),
    ).toBeNull();
    expect(getProxiedClientIp(proxied(" ", secret), secret)).toBeNull();
    expect(getProxiedClientIp(null, secret)).toBeNull();
  });
});
