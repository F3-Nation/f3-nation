import { randomInt } from "node:crypto";

import { env } from "@acme/env";
import { ProviderId } from "@acme/shared/common/enums";

import { sendOtpVerificationRequestServer } from "./send-otp-verification-request-server";

const OtpProvider = {
  id: ProviderId.OTP,
  name: "Email OTP",
  type: "email",
  from: env.EMAIL_FROM,
  server: env.EMAIL_SERVER,
  options: {},
  maxAge: 5 * 60,
  generateVerificationToken: async () => {
    const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const token = Array.from(
      { length: 6 },
      () => characters[randomInt(0, characters.length)],
    ).join("");
    return Promise.resolve(token);
  },
  sendVerificationRequest: sendOtpVerificationRequestServer,
} as const;

export default OtpProvider;
