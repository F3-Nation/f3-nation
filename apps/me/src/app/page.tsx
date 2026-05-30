import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/server";
import { AuthCard } from "@/components/auth-card";
import { safeReturnTo } from "@/lib/auth/validation";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    redirect?: string;
    logged_out?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Show auth card (with error if any) when there's an error or explicit logout.
  // This check must come BEFORE the user redirect to prevent an infinite loop:
  // /profile → user_not_found → / → (user still authed) → /profile → ...
  if (params.error || params.logged_out) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
        <AuthCard error={params.error} />
      </div>
    );
  }

  const user = await getSessionUser();

  // If authenticated, redirect to profile (validated to prevent open redirect)
  if (user) {
    redirect(safeReturnTo(params.redirect));
  }

  // If not authenticated and not just logged out, initiate OAuth flow by redirecting to login
  const returnTo = safeReturnTo(params.redirect);
  redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}
