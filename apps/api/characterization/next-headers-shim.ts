import { headerStore } from "./header-store";

/**
 * Stand-in for `next/headers`, wired in via `resolve.alias` in
 * vitest.characterization.config.ts.
 *
 * next-auth's no-arg `auth()` is `await headers()` -> a plain Request carrying
 * the cookie -> @auth/core `Auth()`, so replacing this one module leaves the
 * real decode path, cookie names, and session callback executing unmocked.
 *
 * An alias rather than `vi.mock`: next-auth is an externalized dependency, so
 * the mock registry never intercepts its `next/headers` import and the real
 * Next `headers()` throws "called outside a request scope".
 */
export function headers(): Promise<Headers> {
  return Promise.resolve(headerStore.getStore() ?? new Headers());
}

export function cookies(): never {
  throw new Error("next/headers cookies() is not shimmed");
}

export function draftMode(): never {
  throw new Error("next/headers draftMode() is not shimmed");
}
