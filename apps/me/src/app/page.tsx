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
  const user = await getSessionUser();

  // If authenticated, redirect to profile (validated to prevent open redirect)
  if (user) {
    redirect(safeReturnTo(params.redirect));
  }

  // If just logged out, show login card instead of auto-redirecting
  if (params.logged_out) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
        <AuthCard error={params.error} />
      </div>
    );
  }

  // If not authenticated and not just logged out, initiate OAuth flow by redirecting to login
  const returnTo = safeReturnTo(params.redirect);
  redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}
