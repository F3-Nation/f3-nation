/**
 * Lazy singleton for the ValidatorClient. Route handlers call this
 * instead of instantiating their own — keeps the secret pinned to a
 * single place and makes it trivial to swap in a fake for tests.
 */

import "server-only";

import { env } from "@/env";
import { ValidatorClient } from "./validator-client";

let _client: ValidatorClient | null = null;

export function getValidatorClient(): ValidatorClient {
  if (_client) return _client;
  const e = env();
  _client = new ValidatorClient({
    baseUrl: e.REGION_BINDING_VALIDATOR_URL,
    s2sSecret: e.REGION_BINDING_VALIDATOR_S2S_SECRET,
    timeoutMs: e.options.validatorTimeoutMs,
  });
  return _client;
}
