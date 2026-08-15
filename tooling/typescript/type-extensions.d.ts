import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

type UserRole = "user" | "editor" | "admin";

type OrgRole = {
  orgId: number;
  orgName: string;
  roleName: UserRole;
};

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string | number;
    email: string | undefined;
    roles: OrgRole[];
    signinunixsecondsepoch: number;
  }
}
/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 * Need separate declaration in @acme/nextjs and @acme/auth
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    id: number;
    email: string | undefined;
    roles?: OrgRole[];
  }

  interface JWT extends DefaultJWT {
    id?: string | number;
    email: string | undefined;
    roles: OrgRole[];
    signinunixsecondsepoch: number;
  }

  interface User {
    // ...other properties
    roles: OrgRole[];
  }
}

declare module "@tanstack/table-core" {
  // Type parameters must match the original declaration for the augmentation to
  // merge (`RowData` is re-exported by @tanstack/table-core).
  interface ColumnMeta<TData extends RowData, TValue> {
    // Used in the Header component and in csv
    name?: string;
    excludeFromCsv?: boolean;
  }
}

// https://stackoverflow.com/questions/71099924/cannot-find-module-file-name-png-or-its-corresponding-type-declarations-type
declare global {
  declare module "*.css" {}
  declare module "*.png" {
    const content: string;
    export default content;
  }
  declare module "*.svg" {
    const content: string;
    export default content;
  }
  declare module "*.jpeg" {
    const content: string;
    export default content;
  }
  declare module "*.jpg" {
    const content: string;
    export default content;
  }
  declare module "*.webp" {
    const content: string;
    export default content;
  }
}

declare global {
  interface Window {
    dataLayer: [string, unknown][];
    gtag: (type: "event" | "config", event: string, params: unknown) => void;
  }
}

// Provide a global NoInfer utility type for libraries that reference it in d.ts
// This prevents inference while acting as a passthrough for T
declare global {
  type NoInfer<T> = [T][T extends any ? 0 : never];
}
