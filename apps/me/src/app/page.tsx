import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/server";
import { AuthCard } from "@/components/auth-card";
import { safeReturnTo } from "@/lib/auth/validation";

interface PageProps {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getSessionUser();

  // If authenticated, redirect to profile (validated to prevent open redirect)
  if (user) {
    redirect(safeReturnTo(params.redirect));
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <AuthCard error={params.error} />
    </div>
  );
}
