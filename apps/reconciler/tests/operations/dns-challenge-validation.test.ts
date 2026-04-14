import { describe, expect, it, vi } from "vitest";

import type {
  CertManagerClient,
  CertificateView,
  DnsAuthorizationView,
} from "../../src/gcp/cert-manager-client.js";
import { NotFoundError, AlreadyExistsError } from "../../src/gcp/errors.js";
import {
  certSpecMatches,
  reconcileOneDnsChallenge,
} from "../../src/operations/dns-challenge-validation.js";
import type { OperationContext } from "../../src/operations/shared.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

function certManagerStub(
  overrides: Partial<CertManagerClient> = {},
): CertManagerClient {
  const base: CertManagerClient = {
    dnsAuthorizationResourcePath: (id: string) =>
      `projects/test/locations/global/dnsAuthorizations/${id}`,
    certificateResourcePath: (id: string) =>
      `projects/test/locations/global/certificates/${id}`,
    async getDnsAuthorization() {
      return null;
    },
    async getCertificate() {
      throw new NotFoundError("Certificate", "unset");
    },
    async createCertificate() {
      // no-op
    },
    async getCertificateMapEntry() {
      return null;
    },
    async createCertificateMapEntry() {
      // no-op
    },
  };
  return { ...base, ...overrides };
}

function makeCtx(
  fakeDb: ReturnType<typeof createFakeDb>,
  certManager: CertManagerClient,
): OperationContext {
  return {
    db: fakeDb.db,
    logger: createFakeLogger(),
    reconcilerRunId: "run-test",
    region: "us-central1",
    certManager,
  };
}

const dnsAuthActive: DnsAuthorizationView = {
  name: "projects/test/locations/global/dnsAuthorizations/dns-auth-aaa",
  domain: "f3marshall.com",
  state: "ACTIVE",
  dnsResourceRecord: null,
};

const certMatching: CertificateView = {
  name: "projects/test/locations/global/certificates/cert-aaa",
  managed: {
    domains: ["f3marshall.com"],
    dnsAuthorizations: [
      "projects/test/locations/global/dnsAuthorizations/dns-auth-aaa",
    ],
    state: "PROVISIONING",
    failureDetails: null,
  },
};

describe("certSpecMatches", () => {
  it("returns true when domain and auth match", () => {
    expect(
      certSpecMatches(certMatching, {
        domain: "f3marshall.com",
        dnsAuthorizationName:
          "projects/test/locations/global/dnsAuthorizations/dns-auth-aaa",
      }),
    ).toBe(true);
  });

  it("returns false when domain differs", () => {
    expect(
      certSpecMatches(certMatching, {
        domain: "other.com",
        dnsAuthorizationName:
          "projects/test/locations/global/dnsAuthorizations/dns-auth-aaa",
      }),
    ).toBe(false);
  });
});

describe("reconcileOneDnsChallenge", () => {
  const row = makeRow({
    id: "aaa",
    lifecycleState: "awaiting_dns_challenge",
    hostname: "f3marshall.com",
  });

  it("no-ops when DnsAuthorization is not yet ACTIVE", async () => {
    const fake = createFakeDb({ rows: [row] });
    const certManager = certManagerStub({
      getDnsAuthorization: async () => ({
        ...dnsAuthActive,
        state: "PENDING",
      }),
    });
    await reconcileOneDnsChallenge(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_dns_challenge");
  });

  it("halts on drift when DnsAuthorization is missing", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    const certManager = certManagerStub({
      getDnsAuthorization: async () => null,
    });
    const ctx = makeCtx(fake, certManager);
    await reconcileOneDnsChallenge(ctx, row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("degraded");
  });

  it("creates the certificate on 404 and advances to provisioning_cert", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    const getCert = vi.fn().mockImplementation(() => {
      throw new NotFoundError("Certificate", "cert-aaa");
    });
    const createCert = vi.fn().mockResolvedValue(undefined);
    const certManager = certManagerStub({
      getDnsAuthorization: async () => dnsAuthActive,
      getCertificate: getCert,
      createCertificate: createCert,
    });
    await reconcileOneDnsChallenge(makeCtx(fake, certManager), row);
    expect(createCert).toHaveBeenCalledOnce();
    expect(fake.state.rows[0]?.lifecycleState).toBe("provisioning_cert");
    expect(
      fake.state.events.find(
        (e) => e.eventType === "reconciler.dns_challenge_validated",
      ),
    ).toBeDefined();
  });

  it("advances when cert already exists with matching spec (crash recovery)", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    const certManager = certManagerStub({
      getDnsAuthorization: async () => dnsAuthActive,
      getCertificate: async () => certMatching,
    });
    await reconcileOneDnsChallenge(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("provisioning_cert");
  });

  it("halts on drift when cert exists but spec mismatches", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    const certManager = certManagerStub({
      getDnsAuthorization: async () => dnsAuthActive,
      getCertificate: async () => ({
        ...certMatching,
        managed: {
          ...certMatching.managed!,
          domains: ["other.com"],
        },
      }),
    });
    await reconcileOneDnsChallenge(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("degraded");
  });

  it("handles ALREADY_EXISTS on create by re-GETting + verifying spec", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    let getCalls = 0;
    const getCert = vi.fn().mockImplementation(() => {
      getCalls++;
      if (getCalls === 1) throw new NotFoundError("Certificate", "cert-aaa");
      return Promise.resolve(certMatching);
    });
    const createCert = vi.fn().mockImplementation(() => {
      throw new AlreadyExistsError("Certificate", "cert-aaa");
    });
    const certManager = certManagerStub({
      getDnsAuthorization: async () => dnsAuthActive,
      getCertificate: getCert,
      createCertificate: createCert,
    });
    await reconcileOneDnsChallenge(makeCtx(fake, certManager), row);
    expect(getCalls).toBe(2);
    expect(fake.state.rows[0]?.lifecycleState).toBe("provisioning_cert");
  });
});
