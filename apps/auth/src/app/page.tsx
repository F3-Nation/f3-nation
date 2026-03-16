import Image from "next/image";
import { redirect } from "next/navigation";

import { auth } from "~/lib/auth";
import SignOutButton from "~/app/components/SignOutButton";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
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
      <div className="w-full max-w-lg space-y-8 rounded-lg border bg-card p-10 shadow-sm">
        <div className="flex flex-col items-center space-y-4">
          <Image
            src="/f3nation.svg"
            alt="F3 Nation Logo"
            width={100}
            height={100}
            priority
          />
          <h1 className="text-3xl font-bold">F3 Nation Auth</h1>
        </div>
        <div className="space-y-2 text-center">
          <p className="text-base text-muted-foreground">Signed in as</p>
          <p className="text-xl font-medium">
            {session.user.name ?? session.user.email}
          </p>
          <p className="text-base text-muted-foreground">
            {session.user.email}
          </p>
        </div>
        <p className="text-base text-muted-foreground">
          Nothing to see here folks. You should have been sent back to where you
          came from. If not, head back and you should be logged in now.
        </p>
        <SignOutButton />
      </div>
    </div>
  );
}
