import VerifyEmailForm from "./verify-email-form";
import { env } from "~/env";

// Server component so the client form can branch on AUTH_USE_BETTER_AUTH
// without a public env var duplicating the server-only flag — see
// apps/auth/src/lib/better-auth-client.ts.
//
// force-dynamic: nothing else here reads a request-time API, so Next.js
// would otherwise statically render this page at build time and bake in
// whatever AUTH_USE_BETTER_AUTH resolves to during `next build` (unset in
// the Docker build, so always false) — the runtime env var toggle would
// then silently never take effect in the deployed image.
export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  return <VerifyEmailForm useBetterAuth={env.AUTH_USE_BETTER_AUTH} />;
}
