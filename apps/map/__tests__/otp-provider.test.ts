import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OtpProvider from "@acme/auth/lib/otp-provider";
import { sendOtpVerificationRequestServer } from "@acme/auth/lib/send-otp-verification-request-server";
import { ProviderId } from "@acme/shared/common/enums";

const { randomInt } = vi.hoisted(() => ({
  randomInt: vi.fn<(min: number, max: number) => number>(),
}));

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt,
}));

// Map has no direct @acme/env dependency; mock the provider's resolved module.
vi.mock("../../../packages/env/src/index", () => ({
  env: {
    EMAIL_FROM: "test@f3local.dev",
    EMAIL_SERVER: "smtp://localhost:1025",
  },
}));

describe("OTP verification tokens", () => {
  beforeEach(() => {
    randomInt.mockReset();
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("OTP generation must not use Math.random");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws six independent characters with an inclusive zero and exclusive 36 bound", async () => {
    randomInt
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(9)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(35)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(35);

    const token = await OtpProvider.generateVerificationToken();

    expect(token).toBe("09AZ0Z");
    expect(token).toMatch(/^[0-9A-Z]{6}$/);
    expect(randomInt).toHaveBeenCalledTimes(6);
    expect(randomInt.mock.calls).toEqual(
      Array.from({ length: 6 }, () => [0, 36]),
    );
    expect(Math.random).not.toHaveBeenCalled();
  });

  it.each([...Array.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ").entries()])(
    "supports alphabet index %i (%s) without changing token length",
    async (index, character) => {
      randomInt.mockReturnValue(index);

      expect(await OtpProvider.generateVerificationToken()).toBe(
        character.repeat(6),
      );
      expect(randomInt).toHaveBeenCalledTimes(6);
      expect(randomInt.mock.calls).toEqual(
        Array.from({ length: 6 }, () => [0, 36]),
      );
    },
  );

  it("rejects a cryptographic source failure without an insecure fallback", async () => {
    const error = new Error("Cryptographic source unavailable");
    randomInt.mockImplementation(() => {
      throw error;
    });

    await expect(OtpProvider.generateVerificationToken()).rejects.toBe(error);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it("preserves the existing email provider and five-minute expiry", () => {
    expect(OtpProvider).toMatchObject({
      id: ProviderId.OTP,
      name: "Email OTP",
      type: "email",
      from: "test@f3local.dev",
      server: "smtp://localhost:1025",
      maxAge: 300,
    });
    expect(OtpProvider.sendVerificationRequest).toBe(
      sendOtpVerificationRequestServer,
    );
  });
});
