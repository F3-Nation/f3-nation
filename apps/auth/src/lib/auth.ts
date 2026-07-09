import NextAuth from "next-auth";

import { authOptions } from "./auth-options";

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
