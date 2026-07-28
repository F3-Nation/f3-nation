import { headerStore } from "./header-store";

/**
 * Stand-in for `next/headers`, wired in via `resolve.alias` in
 * vitest.characterization.config.ts.
 *
 * next-auth's no-arg `auth()` is `await headers()` -> a plain Request carrying
 * the cookie -> @auth/core `Auth()`, so replacing this one module leaves the
 * real decode path, cookie names, and session callback executing unmocked.
 *
 * An alias rather than `vi.mock`: verified empirically that removing the alias
 * and hand-writing a `vi.mock` still lets next-auth pick up the real Next
 * `headers()`, which throws "called outside a request scope".
 */
export function headers(): Promise<Headers> {
  const store = headerStore.getStore();
  if (!store) {
    // An empty Headers is indistinguishable from an unauthenticated request, so
    // every protected procedure would answer 401 instead of surfacing the bug.
    throw new Error(
      "next/headers headers() called outside a characterization request scope — " +
        "the target must wrap dispatch in withRequestHeaders()",
    );
  }
  return Promise.resolve(store);
}

export function cookies(): never {
  throw new Error("next/headers cookies() is not shimmed");
}

export function draftMode(): never {
  throw new Error("next/headers draftMode() is not shimmed");
}
