import Email from "next-auth/providers/nodemailer";

import { env } from "@acme/env";
import { ProviderId } from "@acme/shared/common/enums";
import { normalizeEmail } from "@acme/shared/common/functions";

import { sendVerificationRequest } from "./utils";

export const emailProvider = Email({
  id: ProviderId.EMAIL, // needed to allow signIn("email")
  name: "Email", // Changes text on default sign in button
  server: env.EMAIL_SERVER,
  from: env.EMAIL_FROM,
  sendVerificationRequest,
  normalizeIdentifier: normalizeEmail,
});

// Needed for auth util operations
export const localEmailProvider = {
  ...emailProvider,
  ...emailProvider.options,
};
