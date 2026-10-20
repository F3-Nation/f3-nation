/**
 * The NextAuth OTP callback URL the code form navigates to. Each value is
 * encoded so what the user types stays inside its own query parameter and
 * can't add or override `email` or `callbackUrl`.
 */
export function buildOtpCallbackUrl({
  email,
  code,
  callbackUrl,
}: {
  email: string;
  code: string;
  callbackUrl: string;
}): string {
  return `/api/auth/callback/otp?email=${encodeURIComponent(
    email,
  )}&token=${encodeURIComponent(code)}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
