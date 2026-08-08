import { randomInt } from "crypto";

import { env } from "@acme/env";
import { ProviderId } from "@acme/shared/common/enums";

import { sendOtpVerificationRequestServer } from "./send-otp-verification-request-server";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const OtpProvider = {
  id: ProviderId.OTP,
  name: "Email OTP",
  type: "email",
  from: env.EMAIL_FROM,
  server: env.EMAIL_SERVER,
  options: {},
  maxAge: 5 * 60,
  generateVerificationToken: async () => {
    // Generate a random 6 digit alphanumeric code that includes uppercase letters using CSPRNG
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += ALPHABET[randomInt(ALPHABET.length)];
    }
    return Promise.resolve(token);
  },
  sendVerificationRequest: sendOtpVerificationRequestServer,
} as const;

export default OtpProvider;
