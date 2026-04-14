import { describe, expect, it } from "vitest";

import type { CertManagerClient } from "../../src/gcp/cert-manager-client.js";
import {
  MissingPostCutoverLbIpError,
  expectedRedirectTarget,
  loadPostCutoverConfig,
  reconcileOnePostCutover,
  verifyDnsPointsAtLb,
} from "../../src/operations/post-cutover-verification.js";
import type { OperationContext } from "../../src/operations/shared.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

function certManagerStub(): CertManagerClient {
  return {
    dnsAuthorizationResourcePath: (id) => `dns-${id}`,
    certificateResourcePath: (id) => `cert-${id}`,
    async getDnsAuthorization() {
      return null;
    },
    async getCertificate() {
      throw new Error("not used");
    },
    async createCertificate() {},
    async getCertificateMapEntry() {
      return null;
    },
    async createCertificateMapEntry() {},
  };
}

function makeCtx(fake: ReturnType<typeof createFakeDb>): OperationContext {
  return {
    db: fake.db,
    logger: createFakeLogger(),
    reconcilerRunId: "run-test",
    region: "us-central1",
    certManager: certManagerStub(),
  };
}

describe("expectedRedirectTarget", () => {
  it("returns the regions.f3nation.com URL for apex rows", () => {
    const row = makeRow({
      hostnameRole: "apex",
      regionSlug: "muletown",
      regionId: "35838",
    });
    expect(expectedRedirectTarget(row)).toBe(
      "https://regions.f3nation.com/muletown",
    );
  });
  it("returns the pax-vault URL for stats rows", () => {
    const row = makeRow({
      hostnameRole: "stats",
      regionSlug: "muletown",
      regionId: "35838",
    });
    expect(expectedRedirectTarget(row)).toBe(
      "https://pax-vault.f3nation.com/stats/region/35838",
    );
  });
});

describe("loadPostCutoverConfig", () => {
  it("throws when REDIRECT_LB_IPV4 is absent", () => {
    expect(() => loadPostCutoverConfig({})).toThrow(
      MissingPostCutoverLbIpError,
    );
  });
});

describe("verifyDnsPointsAtLb", () => {
  it("returns a_matches=true when resolve4 returns the lb ip", async () => {
    const result = await verifyDnsPointsAtLb("f3marshall.com", {
      lbIpv4: "34.102.136.180",
      dnsResolver: {
        async resolve4() {
          return ["34.102.136.180"];
        },
        async resolve6() {
          return [];
        },
      },
    });
    expect(result.a_matches).toBe(true);
    expect(result.aaaa_matches).toBe(true); // no IPv6 expected
  });

  it("returns a_matches=false when resolver returns a different ip", async () => {
    const result = await verifyDnsPointsAtLb("f3marshall.com", {
      lbIpv4: "34.102.136.180",
      dnsResolver: {
        async resolve4() {
          return ["1.2.3.4"];
        },
        async resolve6() {
          return [];
        },
      },
    });
    expect(result.a_matches).toBe(false);
  });

  it("captures error when DNS resolution throws", async () => {
    const result = await verifyDnsPointsAtLb("no-such-host.invalid", {
      lbIpv4: "34.102.136.180",
      dnsResolver: {
        async resolve4() {
          throw new Error("ENOTFOUND");
        },
        async resolve6() {
          return [];
        },
      },
    });
    expect(result.a_matches).toBe(false);
    expect(result.error).toContain("A-record lookup failed");
  });
});

describe("reconcileOnePostCutover", () => {
  const row = makeRow({
    id: "pc-1",
    lifecycleState: "awaiting_cutover",
    hostname: "f3marshall.com",
    hostnameRole: "apex",
    regionSlug: "muletown",
    regionId: "35838",
  });

  const mockDns = {
    async resolve4() {
      return ["34.102.136.180"];
    },
    async resolve6() {
      return [];
    },
  };

  it("advances to active on DNS + 307 success", async () => {
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "pc-1", expectedState: "awaiting_cutover" });
    const httpsHead = async () => ({
      status: 307,
      location: "https://regions.f3nation.com/muletown",
    });
    await reconcileOnePostCutover(
      makeCtx(fake),
      { lbIpv4: "34.102.136.180", dnsResolver: mockDns },
      row,
      httpsHead,
    );
    expect(fake.state.rows[0]?.lifecycleState).toBe("active");
  });

  it("stays in awaiting_cutover when DNS still points elsewhere", async () => {
    const fake = createFakeDb({ rows: [row] });
    const httpsHead = async () => ({
      status: 307,
      location: "https://regions.f3nation.com/muletown",
    });
    await reconcileOnePostCutover(
      makeCtx(fake),
      {
        lbIpv4: "34.102.136.180",
        dnsResolver: {
          async resolve4() {
            return ["1.2.3.4"];
          },
          async resolve6() {
            return [];
          },
        },
      },
      row,
      httpsHead,
    );
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_cutover");
  });

  it("stays in awaiting_cutover when the 307 target is wrong", async () => {
    const fake = createFakeDb({ rows: [row] });
    const httpsHead = async () => ({
      status: 307,
      location: "https://regions.f3nation.com/wrong-region",
    });
    await reconcileOnePostCutover(
      makeCtx(fake),
      { lbIpv4: "34.102.136.180", dnsResolver: mockDns },
      row,
      httpsHead,
    );
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_cutover");
  });
});
