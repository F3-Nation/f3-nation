import Email from "next-auth/providers/nodemailer";

import { env } from "@acme/env";
import { ProviderId } from "@acme/shared/common/enums";
import { normalizeEmail } from "@acme/shared/common/functions";

import { sendOtpVerificationRequestServer } from "./send-otp-verification-request-server";

const OtpProvider = Email({
  id: ProviderId.OTP,
  name: "Email OTP",
  server: env.EMAIL_SERVER,
  from: env.EMAIL_FROM,
  maxAge: 5 * 60,
  generateVerificationToken: async () => {
    //Generate a random 6 digit alphanumeric code that includes uppercase letters
    const token = Math.random().toString(36).substring(2, 8).toUpperCase();
    return Promise.resolve(token);
  },
  sendVerificationRequest: sendOtpVerificationRequestServer,
  normalizeIdentifier: normalizeEmail,
});

export default OtpProvider;
