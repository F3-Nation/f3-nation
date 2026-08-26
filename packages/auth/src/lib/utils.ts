import { createHash, randomBytes } from "crypto";
import dayjs from "dayjs";

import type { AppDb } from "@acme/db/client";
import { schema } from "@acme/db";
import { env } from "@acme/env";

import { localEmailProvider, sendVerificationRequest } from "./email-provider";

// Real tokens are in the urls, the hashed is in the database
export const hashToken = (token: string) =>
  createHash("sha256").update(`${token}${env.AUTH_SECRET}`).digest("hex");

export const createAndStoreSignInToken = async (params: {
  db: NonNullable<typeof db>;
  email: string;
  callbackUrl: string;
  expires?: string;
}) => {
  const callbackUrl = params.callbackUrl;
  const identifier = params.email;
  const token = randomBytes(32).toString("hex");
  const hashedToken = hashToken(token);
  const expires = params.expires ?? dayjs().add(7, "day").format();

  await params.db.insert(schema.authVerificationTokens).values({
    token: hashedToken,
    expires,
    identifier,
  });

  return {
    token,
    hashedToken,
    callbackUrl,
    id: localEmailProvider.id,
    email: identifier,
    expires,
  };
};

export const createSignInUrlFromTokenResponse = (params: {
  token: string;
  callbackUrl: string;
  email: string;
}) => {
  const props = new URLSearchParams(params);
  const url = `${env.NEXT_PUBLIC_MAP_URL}/api/auth/callback/${
    localEmailProvider.id
  }?${props.toString()}`;
  return { url };
};

export const createVerifyUrlFromTokenResponse = (params: {
  token: string;
  callbackUrl: string;
  email: string;
}) => {
  const props = new URLSearchParams(params);
  const url = `${env.NEXT_PUBLIC_MAP_URL}/auth/verify-email?${props.toString()}`;
  return { url };
};

export const sendVerifyEmail = async (params: {
  db: AppDb;
  email: string;
  callbackUrl: string;
}) => {
  const responseParams = await createAndStoreSignInToken(params);
  const { url } = createVerifyUrlFromTokenResponse(responseParams);

  await sendVerificationRequest({
    identifier: params.email,
    url,
    provider: localEmailProvider,
    theme: { colorScheme: "auto", logo: "", brandColor: "", buttonText: "" },
    token: responseParams.token,
    expires: new Date(responseParams.expires),
    request: new Request(url),
  });
};
