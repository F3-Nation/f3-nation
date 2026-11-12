import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
} from "@acme/shared/common/client-ip";
import { constantTimeEqual } from "@acme/shared/server/constant-time-equal";

/**
 * The client IP a trusted proxy reported in `x-f3-client-ip`, or null unless
 * `secret` is set and `x-f3-proxy-secret` matches it. Both sides are hashed
 * before the constant-time compare so a wrong secret's length leaks nothing.
 */
export function getProxiedClientIp(
  headers: Pick<Headers, "get"> | null | undefined,
  secret: string | undefined,
): string | null {
  if (!secret) return null;
  const presented = headers?.get(PROXY_SECRET_HEADER);
  const clientIp = headers?.get(PROXY_CLIENT_IP_HEADER)?.trim();
  if (!presented || !clientIp) return null;
  return constantTimeEqual(presented, secret) ? clientIp : null;
}
