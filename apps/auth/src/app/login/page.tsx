import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Sign in to F3 Nation</h1>
          <p className="text-sm text-muted-foreground">
            Choose a sign-in method to continue
          </p>
        </div>
        <Link
          href="/login/email"
          className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Sign in with Email
        </Link>
      </div>
    </div>
  );
}
