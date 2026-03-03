import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/server";
import { AuthCard } from "@/components/auth-card";

interface PageProps {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getSessionUser();

  // If authenticated, redirect to profile
  if (user) {
    redirect(params.redirect ?? "/profile");
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <AuthCard error={params.error} />
    </div>
  );
}
