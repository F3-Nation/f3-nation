/**
 * Stand-in for `next/cache`, wired in via `resolve.alias` in
 * vitest.characterization.config.ts.
 *
 * The revalidate handler calls `revalidatePath("/")`, which throws
 * "Invariant: static generation store missing" outside a Next request scope.
 * That is a post-auth side effect, so characterizing the auth decision means
 * neutralizing it — without it, an authorized request surfaces as a 500 and
 * expectAuthorized has to be loosened to accept 5xx, which is exactly the hole
 * that lets a port's middleware-throws-before-auth regression read as a pass.
 *
 * An alias rather than `vi.mock` for the same reason as next-headers-shim.ts:
 * next/* resolves out of node_modules and is externalized, so the mock registry
 * never intercepts it. Verified empirically — the vi.mock form still ran the
 * real revalidatePath.
 */
export function revalidatePath(_path: string, _type?: string): void {
  // Intentionally a no-op: nothing in the auth matrix asserts cache behavior.
}

export function revalidateTag(_tag: string): void {
  // Intentionally a no-op; see revalidatePath.
}

export function unstable_cache(): never {
  throw new Error("next/cache unstable_cache() is not shimmed");
}
