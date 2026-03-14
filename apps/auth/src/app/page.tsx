import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "~/lib/auth-options";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const params = await searchParams;

  // If there are OAuth params, forward to authorize
  if (params.client_id) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") qs.set(key, value);
    }
    redirect(`/api/oauth/authorize?${qs.toString()}`);
  }

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-bold">F3 Nation Auth</h1>
        <div className="space-y-2">
          <p className="text-muted-foreground">Signed in as</p>
          <p className="text-lg font-medium">
            {session.user.name ?? session.user.email}
          </p>
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          This is the F3 Nation OAuth server. Applications redirect here to
          authenticate users.
        </p>
      </div>
    </div>
  );
}
