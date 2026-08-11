import { cookies } from "next/headers";
import { handleLogoutRoute, SSO_COOKIE_NAMES } from "@f3nation/sso-next";
import { env } from "@/env";
import { sso } from "@/lib/auth/oauth";

function buildPostLogoutUri(): string {
  return `${env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}?logged_out=true`;
}

export async function POST() {
  return handleLogoutRoute(
    async () => {
      const cookieStore = await cookies();
      return cookieStore.get(SSO_COOKIE_NAMES.refreshToken)?.value;
    },
    {
      adapter: sso,
      cookieNames: SSO_COOKIE_NAMES,
      postLogoutRedirectUri: buildPostLogoutUri(),
    },
  );
}
