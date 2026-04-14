import { describe, expect, it, vi } from "vitest";

import {
  createCertManagerClient,
  loadCertManagerConfig,
} from "../../src/gcp/cert-manager-client.js";
import type { UpstreamCertManagerClient } from "../../src/gcp/cert-manager-client.js";
import {
  AlreadyExistsError,
  NotFoundError,
  PermissionDeniedError,
} from "../../src/gcp/errors.js";

function makeUpstream(
  overrides: Partial<UpstreamCertManagerClient> = {},
): UpstreamCertManagerClient {
  const unimplemented = async () => {
    throw new Error("not mocked");
  };
  return {
    getDnsAuthorization: unimplemented,
    getCertificate: unimplemented,
    createCertificate: unimplemented,
    getCertificateMapEntry: unimplemented,
    createCertificateMapEntry: unimplemented,
    ...overrides,
  };
}

const testConfig = {
  projectId: "f3-redirects",
  location: "global",
  certMapName: "redirect-platform-cert-map",
};

describe("loadCertManagerConfig", () => {
  it("falls back to default values when env is empty", () => {
    const config = loadCertManagerConfig({});
    expect(config).toEqual({
      projectId: "f3-redirects",
      location: "global",
      certMapName: "redirect-platform-cert-map",
    });
  });

  it("uses GCP_PROJECT_ID and REDIRECT_CERT_MAP_NAME when set", () => {
    const config = loadCertManagerConfig({
      GCP_PROJECT_ID: "custom-project",
      REDIRECT_CERT_MAP_NAME: "custom-map",
    });
    expect(config.projectId).toBe("custom-project");
    expect(config.certMapName).toBe("custom-map");
  });
});

describe("certManagerClient.getDnsAuthorization", () => {
  it("projects the raw upstream response", async () => {
    const getDnsAuthorization = vi.fn().mockResolvedValue([
      {
        name: "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-abc",
        domain: "f3marshall.com",
        state: "ACTIVE",
        dnsResourceRecord: {
          name: "_acme-challenge.f3marshall.com.",
          type: "CNAME",
          data: "xyz.authorize.certificatemanager.goog.",
        },
      },
    ]);
    const upstream = makeUpstream({ getDnsAuthorization });
    const client = createCertManagerClient(testConfig, upstream);

    const result = await client.getDnsAuthorization("dns-auth-abc");
    expect(result).not.toBeNull();
    expect(result?.state).toBe("ACTIVE");
    expect(result?.dnsResourceRecord?.type).toBe("CNAME");
    expect(getDnsAuthorization).toHaveBeenCalledWith({
      name: "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-abc",
    });
  });

  it("returns null on NOT_FOUND", async () => {
    const getDnsAuthorization = vi.fn().mockImplementation(() => {
      const err = new Error("not found") as Error & { code: number };
      err.code = 5;
      throw err;
    });
    const upstream = makeUpstream({ getDnsAuthorization });
    const client = createCertManagerClient(testConfig, upstream);
    expect(await client.getDnsAuthorization("dns-auth-missing")).toBeNull();
  });

  it("rethrows PERMISSION_DENIED as PermissionDeniedError", async () => {
    const getDnsAuthorization = vi.fn().mockImplementation(() => {
      const err = new Error("denied") as Error & { code: number };
      err.code = 7;
      throw err;
    });
    const upstream = makeUpstream({ getDnsAuthorization });
    const client = createCertManagerClient(testConfig, upstream);
    await expect(
      client.getDnsAuthorization("dns-auth-x"),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("certManagerClient.getCertificate", () => {
  it("projects managed.authorizationAttemptInfo[0].details onto failureDetails", async () => {
    const getCertificate = vi.fn().mockResolvedValue([
      {
        name: "projects/f3-redirects/locations/global/certificates/cert-abc",
        managed: {
          domains: ["f3marshall.com"],
          dnsAuthorizations: [
            "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-abc",
          ],
          state: "FAILED",
          authorizationAttemptInfo: [
            { details: "ACME authorization failed: DNS01 challenge missing" },
          ],
        },
      },
    ]);
    const client = createCertManagerClient(
      testConfig,
      makeUpstream({ getCertificate }),
    );
    const result = await client.getCertificate("cert-abc");
    expect(result.managed?.state).toBe("FAILED");
    expect(result.managed?.failureDetails).toContain("DNS01 challenge missing");
  });

  it("throws NotFoundError on 404", async () => {
    const getCertificate = vi.fn().mockImplementation(() => {
      const err = new Error("missing") as Error & { code: number };
      err.code = 5;
      throw err;
    });
    const client = createCertManagerClient(
      testConfig,
      makeUpstream({ getCertificate }),
    );
    await expect(client.getCertificate("cert-missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("certManagerClient.createCertificate", () => {
  it("awaits the LRO.promise() and passes the expected request shape", async () => {
    const lroPromise = vi.fn().mockResolvedValue([{}, null, null]);
    const createCertificate = vi
      .fn()
      .mockResolvedValue([{ promise: lroPromise }]);
    const client = createCertManagerClient(
      testConfig,
      makeUpstream({ createCertificate }),
    );
    await client.createCertificate({
      certificateId: "cert-abc",
      domain: "f3marshall.com",
      dnsAuthorizationName:
        "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-abc",
    });
    expect(createCertificate).toHaveBeenCalledTimes(1);
    const [callArg] = createCertificate.mock.calls[0] as [
      {
        parent: string;
        certificateId: string;
        certificate: { managed: { domains: string[] } };
      },
    ];
    expect(callArg.parent).toBe("projects/f3-redirects/locations/global");
    expect(callArg.certificateId).toBe("cert-abc");
    expect(callArg.certificate.managed.domains).toEqual(["f3marshall.com"]);
    expect(lroPromise).toHaveBeenCalled();
  });

  it("throws AlreadyExistsError on ALREADY_EXISTS", async () => {
    const createCertificate = vi.fn().mockImplementation(() => {
      const err = new Error("exists") as Error & { code: number };
      err.code = 6;
      throw err;
    });
    const client = createCertManagerClient(
      testConfig,
      makeUpstream({ createCertificate }),
    );
    await expect(
      client.createCertificate({
        certificateId: "cert-abc",
        domain: "f3marshall.com",
        dnsAuthorizationName:
          "projects/f3-redirects/locations/global/dnsAuthorizations/dns-auth-abc",
      }),
    ).rejects.toBeInstanceOf(AlreadyExistsError);
  });
});

describe("certManagerClient.getCertificateMapEntry", () => {
  it("returns null on 404 and projects certificates array", async () => {
    const getCertificateMapEntry = vi
      .fn()
      .mockResolvedValueOnce([null])
      .mockImplementationOnce(() => {
        const err = new Error("not found") as Error & { code: number };
        err.code = 5;
        throw err;
      });
    const client = createCertManagerClient(
      testConfig,
      makeUpstream({ getCertificateMapEntry }),
    );
    const first = await client.getCertificateMapEntry("cme-a");
    expect(first).not.toBeNull();
    // null response maps to a zero-valued projection; certificates is empty array
    expect(first?.certificates).toEqual([]);

    const second = await client.getCertificateMapEntry("cme-b");
    expect(second).toBeNull();
  });
});

describe("certManagerClient.createCertificateMapEntry", () => {
  it("uses the cert map parent path and awaits the LRO", async () => {
    const lroPromise = vi.fn().mockResolvedValue([{}, null, null]);
    const createCertificateMapEntry = vi
      .fn()
      .mockResolvedValue([{ promise: lroPromise }]);
    const client = createCertManagerClient(
      testConfig,
      makeUpstream({ createCertificateMapEntry }),
    );
    await client.createCertificateMapEntry({
      entryId: "cme-abc",
      hostname: "f3marshall.com",
      certificateName:
        "projects/f3-redirects/locations/global/certificates/cert-abc",
    });
    const [req] = createCertificateMapEntry.mock.calls[0] as [
      {
        parent: string;
        certificateMapEntryId: string;
        certificateMapEntry: { hostname: string; certificates: string[] };
      },
    ];
    expect(req.parent).toBe(
      "projects/f3-redirects/locations/global/certificateMaps/redirect-platform-cert-map",
    );
    expect(req.certificateMapEntryId).toBe("cme-abc");
    expect(req.certificateMapEntry.hostname).toBe("f3marshall.com");
    expect(req.certificateMapEntry.certificates).toEqual([
      "projects/f3-redirects/locations/global/certificates/cert-abc",
    ]);
    expect(lroPromise).toHaveBeenCalled();
  });
});
