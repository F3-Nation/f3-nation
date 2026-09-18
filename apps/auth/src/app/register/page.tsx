import RegisterForm from "./register-form";
import { env } from "~/env";

// Server component so the client form can branch on AUTH_USE_BETTER_AUTH
// without a public env var duplicating the server-only flag — see
// apps/auth/src/lib/better-auth-client.ts.
export default function RegisterPage() {
  return <RegisterForm useBetterAuth={env.AUTH_USE_BETTER_AUTH} />;
}
