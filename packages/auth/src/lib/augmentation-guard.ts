import type { JWT } from "@auth/core/jwt";
import type { Session, User } from "next-auth";

/**
 * Compile-time guard for the `declare module` augmentations in
 * tooling/typescript/type-extensions.d.ts.
 *
 * A module augmentation binds to a *resolved file*, not a package name. Two
 * `next` versions in the tree fork next-auth's pnpm peer instance, which
 * detaches these augmentations repo-wide — silently, because the custom members
 * just revert to the upstream types instead of erroring. These assertions turn
 * that into a typecheck failure.
 */
type Assert<T extends true> = T;

// `Session` and `User` have no index signature, so a detached augmentation
// errors on the index access itself. `JWT extends Record<string, unknown>`
// widens to `unknown` instead, which is what `IsKnown` catches.
type IsKnown<T> = unknown extends T ? false : true;

// `Session.id`/`Session.roles` are also declared by the `next-auth` augmentation
// in packages/shared/src/app/types.ts, so these two assert availability to
// consumers rather than isolating this file's augmentation specifically —
// unlike the three below, they stay green even if only this file detaches.
export type AssertSessionId = Assert<IsKnown<Session["id"]>>;
export type AssertSessionRoles = Assert<IsKnown<Session["roles"]>>;
export type AssertUserRoles = Assert<IsKnown<User["roles"]>>;
export type AssertJwtRoles = Assert<IsKnown<JWT["roles"]>>;
export type AssertJwtSigninEpoch = Assert<
  IsKnown<JWT["signinunixsecondsepoch"]>
>;
