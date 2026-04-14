import { describe, expect, it } from "vitest";

import {
  SpecMismatchError,
  deterministicResourceName,
  handleAlreadyExists,
  haltOnDrift,
  stateGuardedUpdate,
} from "../../src/operations/shared.js";
import { NotFoundError } from "../../src/gcp/errors.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

describe("deterministicResourceName", () => {
  it("returns the R5 Decision 6 name prefixes", () => {
    expect(deterministicResourceName("DnsAuthorization", "abc")).toBe(
      "dns-auth-abc",
    );
    expect(deterministicResourceName("Certificate", "abc")).toBe("cert-abc");
    expect(deterministicResourceName("CertificateMapEntry", "abc")).toBe(
      "cme-abc",
    );
  });
});

describe("stateGuardedUpdate", () => {
  it("advances state when the guard matches", async () => {
    const row = makeRow({
      id: "aaa",
      lifecycleState: "awaiting_dns_challenge",
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    const updated = await stateGuardedUpdate(fake.db, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
      newState: "provisioning_cert",
    });
    expect(updated).not.toBeNull();
    expect(updated?.lifecycleState).toBe("provisioning_cert");
    expect(fake.state.rows[0]?.lifecycleState).toBe("provisioning_cert");
  });

  it("returns null when the guard does not match", async () => {
    const row = makeRow({ id: "aaa", lifecycleState: "active" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
    });
    const updated = await stateGuardedUpdate(fake.db, {
      id: "aaa",
      expectedState: "awaiting_dns_challenge",
      newState: "provisioning_cert",
    });
    expect(updated).toBeNull();
    expect(fake.state.rows[0]?.lifecycleState).toBe("active");
  });
});

describe("handleAlreadyExists", () => {
  it("returns the existing resource when spec matches", async () => {
    const result = await handleAlreadyExists({
      resourceKind: "Certificate",
      rowId: "x",
      resourceName: "cert-x",
      plannedSpec: { domain: "f3marshall.com" },
      getFn: async () => ({ domain: "f3marshall.com", state: "ACTIVE" }),
      specMatches: (existing, planned) => existing.domain === planned.domain,
    });
    expect(result.existing.domain).toBe("f3marshall.com");
  });

  it("throws SpecMismatchError on mismatch", async () => {
    await expect(
      handleAlreadyExists({
        resourceKind: "Certificate",
        rowId: "x",
        resourceName: "cert-x",
        plannedSpec: { domain: "f3marshall.com" },
        getFn: async () => ({ domain: "other.com" }),
        specMatches: (existing, planned) => existing.domain === planned.domain,
      }),
    ).rejects.toBeInstanceOf(SpecMismatchError);
  });

  it("throws NotFoundError when GET returns null", async () => {
    await expect(
      handleAlreadyExists<{ x: number }, { x: number }>({
        resourceKind: "Certificate",
        rowId: "x",
        resourceName: "cert-x",
        plannedSpec: { x: 1 },
        getFn: async () => null,
        specMatches: () => true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("haltOnDrift", () => {
  it("transitions row to degraded, writes reconciler_error, emits drift log", async () => {
    const row = makeRow({
      id: "bbb",
      lifecycleState: "awaiting_dns_challenge",
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "bbb",
      expectedState: "awaiting_dns_challenge",
    });
    const logger = createFakeLogger();
    const result = await haltOnDrift({
      db: fake.db,
      logger,
      rowId: "bbb",
      currentState: "awaiting_dns_challenge",
      driftKind: "spec_mismatch",
      resourceType: "Certificate",
      resourceName: "cert-bbb",
      observedSpec: { managed: { state: "FAILED" } },
      expectedSpec: { managed: { state: "ACTIVE" } },
      recoverableFrom: "awaiting_dns_challenge",
      reconcilerRunId: "run-1",
    });
    expect(result?.lifecycleState).toBe("degraded");
    expect(logger.driftCalls).toHaveLength(1);
    // An event should have been inserted for the halt
    expect(fake.state.events).toHaveLength(1);
    expect(fake.state.events[0]?.eventType).toBe("reconciler.halt_on_drift");
  });

  it("returns null (no-op) when state guard fails", async () => {
    const row = makeRow({ id: "ccc", lifecycleState: "active" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, {
      id: "ccc",
      expectedState: "awaiting_dns_challenge",
    });
    const logger = createFakeLogger();
    const result = await haltOnDrift({
      db: fake.db,
      logger,
      rowId: "ccc",
      currentState: "awaiting_dns_challenge",
      driftKind: "spec_mismatch",
      resourceType: "Certificate",
      resourceName: "cert-ccc",
      observedSpec: {},
      expectedSpec: {},
      recoverableFrom: "awaiting_dns_challenge",
      reconcilerRunId: "run-1",
    });
    expect(result).toBeNull();
    expect(logger.driftCalls).toHaveLength(0);
    expect(logger.warnCalls).toHaveLength(1);
  });
});
