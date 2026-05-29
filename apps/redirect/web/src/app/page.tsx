import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthForm } from "@/components/AuthForm";

export default async function Home() {
  const sess = await auth.api.getSession({ headers: await headers() });
  if (sess?.user) redirect("/dashboard");

  return (
    <div>
      <h1>F3 Redirect</h1>
      <p className="muted">
        Register a custom domain and point it anywhere. Sign in, add a domain
        plus a destination URL, and we&apos;ll give you the exact DNS records to
        set up the redirect — with automatic HTTPS.
      </p>
      <div className="card">
        <p>Sign in to manage your domains.</p>
        <AuthForm />
      </div>
      <p className="muted">
        Prefer the command line? Admins can still manage redirects via the{" "}
        <code>f3redirect</code> CLI.
      </p>
    </div>
  );
}
