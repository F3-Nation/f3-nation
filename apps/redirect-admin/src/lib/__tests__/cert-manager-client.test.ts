import { describe, it, expect, vi } from "vitest";

import {
  buildDnsAuthorizationId,
  buildParent,
  buildResourceName,
  createOrReuseDnsAuthorization,
  extractDnsChallenge,
  isAlreadyExistsError,
} from "../cert-manager-client";
import type {
  CertManagerLike,
  DnsAuthorizationShape,
} from "../cert-manager-client";

describe("buildDnsAuthorizationId", () => {
  it("prefixes with dns-auth-", () => {
    expect(buildDnsAuthorizationId("abc-123")).toBe("dns-auth-abc-123");
  });
});

describe("buildParent / buildResourceName", () => {
  it("builds project-scoped parent", () => {
    expect(buildParent("f3-redirects", "global")).toBe(
      "projects/f3-redirects/locations/global",
    );
  });
  it("builds resource name", () => {
    expect(buildResourceName("f3-redirects", "global", "dns-auth-xyz")).toBe(
      "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-xyz",
    );
  });
});

describe("extractDnsChallenge", () => {
  it("pulls out the CNAME record", () => {
    const authorization: DnsAuthorizationShape = {
      name: "projects/p/locations/global/dnsAuthorizations/dns-auth-1",
      dnsResourceRecord: {
        name: "_acme-challenge.f3muletown.com.",
        type: "CNAME",
        data: "gcp-target.example.com.",
      },
    };
    const challenge = extractDnsChallenge(authorization);
    expect(challenge).toEqual({
      name: "_acme-challenge.f3muletown.com.",
      data: "gcp-target.example.com.",
      type: "CNAME",
    });
  });

  it("throws when the record is missing", () => {
    expect(() =>
      extractDnsChallenge({
        dnsResourceRecord: { name: null, data: null },
      }),
    ).toThrow(/missing dnsResourceRecord/);
  });
});

describe("isAlreadyExistsError", () => {
  it("matches grpc code 6", () => {
    expect(isAlreadyExistsError({ code: 6 })).toBe(true);
  });
  it("matches string message", () => {
    expect(isAlreadyExistsError(new Error("Resource already exists"))).toBe(
      true,
    );
  });
  it("rejects unrelated errors", () => {
    expect(isAlreadyExistsError(new Error("boom"))).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
  });
});

describe("createOrReuseDnsAuthorization", () => {
  const hostname = "f3muletown.com";
  const authorizationId = "dns-auth-deadbeef";

  function makeAuthorization(): DnsAuthorizationShape {
    return {
      name: `projects/f3-redirects/locations/global/dnsAuthorizations/${authorizationId}`,
      dnsResourceRecord: {
        name: "_acme-challenge.f3muletown.com.",
        type: "CNAME",
        data: "target.googleusercontent.com.",
      },
    };
  }

  it("creates + returns the challenge on happy path", async () => {
    const authorization = makeAuthorization();
    const create = vi.fn().mockResolvedValue([
      {
        promise: vi.fn().mockResolvedValue([authorization]),
      },
    ]);
    const get = vi.fn();
    const fakeClient: CertManagerLike = {
      createDnsAuthorization: create,
      getDnsAuthorization: get,
    };

    const result = await createOrReuseDnsAuthorization(() => fakeClient, {
      authorizationId,
      hostname,
      projectId: "f3-redirects",
    });

    expect(result.reused).toBe(false);
    expect(result.challenge.name).toBe("_acme-challenge.f3muletown.com.");
    expect(result.challenge.data).toBe("target.googleusercontent.com.");
    expect(create).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it("falls back to GET on ALREADY_EXISTS", async () => {
    const authorization = makeAuthorization();
    const error = Object.assign(new Error("already exists"), { code: 6 });
    const create = vi.fn().mockRejectedValue(error);
    const get = vi.fn().mockResolvedValue([authorization]);
    const fakeClient: CertManagerLike = {
      createDnsAuthorization: create,
      getDnsAuthorization: get,
    };

    const result = await createOrReuseDnsAuthorization(() => fakeClient, {
      authorizationId,
      hostname,
      projectId: "f3-redirects",
    });

    expect(result.reused).toBe(true);
    expect(get).toHaveBeenCalledWith({
      name: `projects/f3-redirects/locations/global/dnsAuthorizations/${authorizationId}`,
    });
  });

  it("rethrows non-AlreadyExists errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("permission denied"));
    const get = vi.fn();
    const fakeClient: CertManagerLike = {
      createDnsAuthorization: create,
      getDnsAuthorization: get,
    };

    await expect(
      createOrReuseDnsAuthorization(() => fakeClient, {
        authorizationId,
        hostname,
        projectId: "f3-redirects",
      }),
    ).rejects.toThrow(/permission denied/);
    expect(get).not.toHaveBeenCalled();
  });
});
