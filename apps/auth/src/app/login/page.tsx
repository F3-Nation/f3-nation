import Image from "next/image";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-lg space-y-8 rounded-lg border bg-card p-10 shadow-sm">
        <div className="flex flex-col items-center space-y-4">
          <Image
            src="/f3nation.svg"
            alt="F3 Nation Logo"
            width={120}
            height={120}
            priority
          />
          <h1 className="text-3xl font-bold">F3 Nation Auth Provider</h1>
          <p className="text-center text-base text-muted-foreground">
            Central authentication service for F3 Nation applications
          </p>
        </div>
        <Link
          href="/login/email"
          className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in with Email
        </Link>
      </div>
    </div>
  );
}
