import { describe, expect, it } from "vitest";

import {
  AlreadyExistsError,
  GRPC_STATUS_ALREADY_EXISTS,
  GRPC_STATUS_NOT_FOUND,
  GRPC_STATUS_PERMISSION_DENIED,
  NotFoundError,
  PermissionDeniedError,
  mapGcpError,
} from "../../src/gcp/errors.js";

describe("mapGcpError", () => {
  it("passes through the successful value", async () => {
    const result = await mapGcpError(
      "Certificate",
      "projects/p/locations/global/certificates/cert-1",
      async () => "ok",
    );
    expect(result).toBe("ok");
  });

  it("translates NOT_FOUND (code 5) into NotFoundError", async () => {
    await expect(
      mapGcpError("DnsAuthorization", "dns-auth-x", async () => {
        const err = new Error("not found") as Error & { code: number };
        err.code = GRPC_STATUS_NOT_FOUND;
        throw err;
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("translates ALREADY_EXISTS (code 6) into AlreadyExistsError", async () => {
    await expect(
      mapGcpError("Certificate", "cert-1", async () => {
        const err = new Error("already exists") as Error & { code: number };
        err.code = GRPC_STATUS_ALREADY_EXISTS;
        throw err;
      }),
    ).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it("translates PERMISSION_DENIED (code 7) into PermissionDeniedError", async () => {
    await expect(
      mapGcpError("Certificate", "cert-1", async () => {
        const err = new Error("denied") as Error & { code: number };
        err.code = GRPC_STATUS_PERMISSION_DENIED;
        throw err;
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rethrows unknown errors unchanged", async () => {
    const original = new Error("unknown");
    await expect(
      mapGcpError("Certificate", "cert-1", async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("rethrows errors without a numeric code field", async () => {
    const original = new Error("string code") as Error & { code: string };
    original.code = "ENOTFOUND";
    await expect(
      mapGcpError("Certificate", "cert-1", async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });
});
