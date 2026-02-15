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
    //Generate a random 6 digit alphanumeric code that includes uppercase letters
    const token = Math.random().toString(36).substring(2, 8).toUpperCase();
    return Promise.resolve(token);
  },
  sendVerificationRequest: sendOtpVerificationRequestServer,
} as const;

export default OtpProvider;
