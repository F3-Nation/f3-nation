import NextAuth from "next-auth";

import { authOptions } from "./auth-options";

export const { handlers, auth } = NextAuth(authOptions);
