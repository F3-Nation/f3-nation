import type * as NodeCrypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OtpProvider from "@acme/auth/lib/otp-provider";
import { sendOtpEmail } from "@acme/auth/lib/send-otp-email";
import { ProviderId } from "@acme/shared/common/enums";

const { randomInt, createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return {
    randomInt: vi.fn<(min: number, max: number) => number>(),
    createTransport: vi.fn(() => ({ sendMail })),
    sendMail,
  };
});

vi.mock("nodemailer", () => ({ createTransport }));

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeCrypto>()),
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
    expect(OtpProvider.sendVerificationRequest).toBe(sendOtpEmail);
  });
});

describe("OTP email delivery", () => {
  const forgedHostUrl =
    "https://attacker.example/api/auth/callback/otp?token=AB12CD";

  beforeEach(() => {
    createTransport.mockClear();
    sendMail.mockReset();
    sendMail.mockResolvedValue({ rejected: [], pending: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("OTP delivery must not make an HTTP request");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mails the code through the configured SMTP server without an HTTP relay", async () => {
    await OtpProvider.sendVerificationRequest({
      identifier: "user@example.com",
      url: forgedHostUrl,
      token: "AB12CD",
      expires: new Date(),
      provider: { server: OtpProvider.server, from: OtpProvider.from },
      theme: {},
      request: new Request(forgedHostUrl),
    } as unknown as Parameters<typeof OtpProvider.sendVerificationRequest>[0]);

    expect(fetch).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith("smtp://localhost:1025");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: "user@example.com",
      from: "test@f3local.dev",
      subject: "Authentication code: AB12CD",
    });
  });
});
