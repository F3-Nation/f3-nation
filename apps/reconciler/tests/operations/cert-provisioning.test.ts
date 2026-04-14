import { describe, expect, it } from "vitest";

import type {
  CertManagerClient,
  CertificateMapEntryView,
  CertificateView,
} from "../../src/gcp/cert-manager-client.js";
import { NotFoundError } from "../../src/gcp/errors.js";
import {
  cmeSpecMatches,
  reconcileOneCertProvisioning,
} from "../../src/operations/cert-provisioning.js";
import type { OperationContext } from "../../src/operations/shared.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

function certManagerStub(
  overrides: Partial<CertManagerClient> = {},
): CertManagerClient {
  return {
    dnsAuthorizationResourcePath: (id) =>
      `projects/test/locations/global/dnsAuthorizations/${id}`,
    certificateResourcePath: (id) =>
      `projects/test/locations/global/certificates/${id}`,
    certificateMapEntryResourcePath: (id) =>
      `projects/test/locations/global/certificateMaps/redirect-platform-cert-map/certificateMapEntries/${id}`,
    async getDnsAuthorization() {
      return null;
    },
    async getCertificate() {
      throw new NotFoundError("Certificate", "unset");
    },
    async getCertificateView() {
      return null;
    },
    async createCertificate() {},
    async deleteCertificate() {},
    async getCertificateMapEntry() {
      return null;
    },
    async createCertificateMapEntry() {},
    async deleteCertificateMapEntry() {},
    async deleteDnsAuthorization() {},
    async listDnsAuthorizations() {
      return [];
    },
    async listCertificates() {
      return [];
    },
    async listCertificateMapEntries() {
      return [];
    },
    ...overrides,
  };
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

const activeCert: CertificateView = {
  name: "projects/test/locations/global/certificates/cert-aaa",
  managed: {
    domains: ["f3marshall.com"],
    dnsAuthorizations: [
      "projects/test/locations/global/dnsAuthorizations/dns-auth-aaa",
    ],
    state: "ACTIVE",
    failureDetails: null,
  },
};

const provisioningCert: CertificateView = {
  ...activeCert,
  managed: { ...activeCert.managed!, state: "PROVISIONING" },
};

const failedCert: CertificateView = {
  ...activeCert,
  managed: {
    ...activeCert.managed!,
    state: "FAILED",
    failureDetails: "ACME challenge missing",
  },
};

const matchingCme: CertificateMapEntryView = {
  name: "projects/test/locations/global/certificateMaps/redirect-platform-cert-map/certificateMapEntries/cme-aaa",
  hostname: "f3marshall.com",
  certificates: ["projects/test/locations/global/certificates/cert-aaa"],
};

describe("cmeSpecMatches", () => {
  it("matches when hostname and cert path align", () => {
    expect(
      cmeSpecMatches(matchingCme, {
        hostname: "f3marshall.com",
        certificateName: "projects/test/locations/global/certificates/cert-aaa",
      }),
    ).toBe(true);
  });

  it("rejects on hostname mismatch", () => {
    expect(
      cmeSpecMatches(matchingCme, {
        hostname: "other.com",
        certificateName: "projects/test/locations/global/certificates/cert-aaa",
      }),
    ).toBe(false);
  });
});

describe("reconcileOneCertProvisioning", () => {
  const row = makeRow({
    id: "aaa",
    lifecycleState: "provisioning_cert",
    hostname: "f3marshall.com",
  });

  it("no-ops while cert is still PROVISIONING", async () => {
    const fake = createFakeDb({ rows: [row] });
    const certManager = certManagerStub({
      async getCertificate() {
        return provisioningCert;
      },
    });
    await reconcileOneCertProvisioning(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("provisioning_cert");
  });

  it("creates CME and advances to awaiting_probe when cert is ACTIVE and CME missing", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "aaa", expectedState: "provisioning_cert" });
    const certManager = certManagerStub({
      async getCertificate() {
        return activeCert;
      },
      async getCertificateMapEntry() {
        return null;
      },
    });
    await reconcileOneCertProvisioning(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_probe");
    expect(
      fake.state.events.find(
        (e) => e.eventType === "reconciler.cert_active_attached",
      ),
    ).toBeDefined();
  });

  it("reuses an existing matching CME and advances", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "aaa", expectedState: "provisioning_cert" });
    const certManager = certManagerStub({
      async getCertificate() {
        return activeCert;
      },
      async getCertificateMapEntry() {
        return matchingCme;
      },
    });
    await reconcileOneCertProvisioning(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_probe");
  });

  it("halts on drift when CME exists with wrong hostname", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "aaa", expectedState: "provisioning_cert" });
    const certManager = certManagerStub({
      async getCertificate() {
        return activeCert;
      },
      async getCertificateMapEntry() {
        return { ...matchingCme, hostname: "attacker.com" };
      },
    });
    await reconcileOneCertProvisioning(makeCtx(fake, certManager), row);
    expect(fake.state.rows[0]?.lifecycleState).toBe("degraded");
  });

  it("transitions to degraded on FAILED cert with recoverable_from=awaiting_dns_challenge", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "aaa", expectedState: "provisioning_cert" });
    const certManager = certManagerStub({
      async getCertificate() {
        return failedCert;
      },
    });
    await reconcileOneCertProvisioning(makeCtx(fake, certManager), row);
    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const reconcilerError = updated?.reconcilerError as {
      recoverable_from?: string;
      details?: string;
    } | null;
    expect(reconcilerError?.recoverable_from).toBe("awaiting_dns_challenge");
    expect(reconcilerError?.details).toBe("ACME challenge missing");
  });
});
