import { describe, expect, it, vi } from "vitest";

import {
  verifyBinding,
  statusForVerifyBindingError,
  publicVerifyBindingErrorBody,
} from "../services/verify-binding";
import type {
  VerifyBindingDb,
  VerifyValidatorClient,
} from "../services/verify-binding";
import {
  TripleMismatchError,
  ValidatorUnavailableError,
} from "../validator-client";
import type { ValidatorResponseBody } from "../validator-client";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeDbConfig {
  bindingRows?: unknown[];
  updateReturning?: unknown[];
  updateThrows?: Error;
}

function fakeDb(cfg: FakeDbConfig = {}): VerifyBindingDb & {
  _updateCalls: unknown[];
} {
  const bindingRows = cfg.bindingRows ?? [];
  const updateReturning = cfg.updateReturning ?? [];
  const updateCalls: unknown[] = [];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => bindingRows),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals) => {
        updateCalls.push(vals);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (cfg.updateThrows) throw cfg.updateThrows;
              return updateReturning;
            }),
          })),
        };
      }),
    })),
    _updateCalls: updateCalls,
  };
}

function validatorResponse(
  overrides: Partial<ValidatorResponseBody> = {},
): ValidatorResponseBody {
  return {
    org: {
      id: 42,
      name: "F3 Muletown",
      last_modified: "2026-04-13T00:00:00Z",
      admin_count: 3,
      caller_roles: ["admin"],
    },
    pax_vault: {
      region_id: "pv-muletown",
      region_name: "Muletown",
    },
    f3_region_pages: { slug: "muletown" },
    cross_check: { triple_matches: true, match_strategy: "exact" },
    validated_at: "2026-04-14T00:00:00Z",
    ...overrides,
  };
}

function fakeValidator(
  respOrErr: ValidatorResponseBody | Error,
): VerifyValidatorClient & { _calls: number } {
  let calls = 0;
  return {
    validate: vi.fn(async () => {
      calls += 1;
      if (respOrErr instanceof Error) throw respOrErr;
      return respOrErr;
    }),
    get _calls() {
      return calls;
    },
  };
}

const binding = {
  orgId: 42,
  paxVaultRegionId: "pv-muletown",
  regionSlug: "muletown",
  regionName: "Muletown",
  verificationState: "unverified",
  source: "manual_admin",
  boundByUserId: 99,
  boundAt: "2026-04-13T00:00:00Z",
  createdAt: "2026-04-13T00:00:00Z",
  updatedAt: "2026-04-13T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyBinding", () => {
  it("confirm happy path — UPDATE binding + log", async () => {
    const db = fakeDb({
      bindingRows: [binding],
      updateReturning: [{ ...binding, verificationState: "verified" }],
    });
    const validator = fakeValidator(validatorResponse());
    const logger = { info: vi.fn() };
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "confirm" },
      { db, validator, logger },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.action).toBe("confirm");
    expect(db._updateCalls).toHaveLength(1);
    const updatePayload = db._updateCalls[0] as Record<string, unknown>;
    expect(updatePayload.verificationState).toBe("verified");
    expect(updatePayload.verifiedByUserId).toBe(99);
    expect(updatePayload.verificationMethod).toBe("region_admin_confirmed");
    expect(updatePayload.bindTimeValidatorSnapshot).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "verified", org_id: 42 }),
    );
  });

  it("report_mismatch path — no UPDATE, logs with validator_snapshot", async () => {
    const db = fakeDb({ bindingRows: [binding] });
    const validator = fakeValidator(validatorResponse());
    const logger = { info: vi.fn() };
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "report_mismatch" },
      { db, validator, logger },
    );
    expect(result.ok).toBe(true);
    expect(db._updateCalls).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reported_mismatch",
        org_id: 42,
        ticket_status: "logged_only",
      }),
    );
  });

  it("returns binding_not_found when no row", async () => {
    const db = fakeDb({ bindingRows: [] });
    const validator = fakeValidator(validatorResponse());
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "confirm" },
      { db, validator },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("binding_not_found");
    expect(validator._calls).toBe(0);
  });

  it("returns already_verified when binding is verified", async () => {
    const db = fakeDb({
      bindingRows: [{ ...binding, verificationState: "verified" }],
    });
    const validator = fakeValidator(validatorResponse());
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "confirm" },
      { db, validator },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("already_verified");
  });

  it("returns validator_unavailable when validator throws 503", async () => {
    const db = fakeDb({ bindingRows: [binding] });
    const validator = fakeValidator(
      new ValidatorUnavailableError("service down"),
    );
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "confirm" },
      { db, validator },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validator_unavailable");
  });

  it("returns triple_mismatch on TripleMismatchError", async () => {
    const db = fakeDb({ bindingRows: [binding] });
    const validator = fakeValidator(
      new TripleMismatchError("mismatch", [
        { field: "slug", sources: { a: "x" }, reason: "differs" },
      ]),
    );
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "confirm" },
      { db, validator },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "triple_mismatch") {
      expect(result.error.mismatches).toEqual([
        { field: "slug", reason: "differs" },
      ]);
    } else {
      expect.fail("expected triple_mismatch");
    }
  });

  it("defense-in-depth: triple_matches=false on confirm still rejects", async () => {
    const db = fakeDb({ bindingRows: [binding] });
    const validator = fakeValidator(
      validatorResponse({
        cross_check: { triple_matches: false, match_strategy: "failed" },
      }),
    );
    const result = await verifyBinding(
      { orgId: 42, userId: 99, action: "confirm" },
      { db, validator },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("triple_mismatch");
    expect(db._updateCalls).toHaveLength(0);
  });

  it("maps errors to HTTP status", () => {
    expect(statusForVerifyBindingError({ code: "binding_not_found" })).toBe(
      404,
    );
    expect(statusForVerifyBindingError({ code: "already_verified" })).toBe(409);
    expect(
      statusForVerifyBindingError({
        code: "validator_unavailable",
        message: "x",
      }),
    ).toBe(503);
    expect(
      statusForVerifyBindingError({ code: "triple_mismatch", mismatches: [] }),
    ).toBe(422);
    expect(
      statusForVerifyBindingError({ code: "internal_error", message: "x" }),
    ).toBe(500);
  });

  it("public error body never leaks internal_error message", () => {
    expect(
      publicVerifyBindingErrorBody({
        code: "internal_error",
        message: "secret",
      }),
    ).toEqual({ error: "internal_error" });
  });
});
