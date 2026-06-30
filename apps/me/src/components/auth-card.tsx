"use client";

import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";

interface AuthCardProps {
  error?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "Please sign in to continue.",
  missing_params: "Invalid authentication response. Please try again.",
  invalid_state: "Security validation failed. Please try again.",
  expired_state: "Login session expired. Please try again.",
  csrf_mismatch: "Security validation failed. Please try again.",
  missing_code_verifier: "Login session expired. Please try again.",
  token_exchange_failed: "Authentication failed. Please try again.",
  userinfo_failed: "Unable to retrieve your account. Please try again.",
};

export function AuthCard({ error }: AuthCardProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4">
          <Image
            src="/f3_logo.png"
            alt="F3 Nation"
            width={80}
            height={80}
            className="rounded-xl"
          />
        </div>
        <CardTitle className="text-2xl">Welcome to F3 Me</CardTitle>
        <CardDescription>
          Manage your F3 Nation profile — update your info, avatar, emergency
          contacts, and more.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {ERROR_MESSAGES[error] ?? `An error occurred: ${error}`}
          </div>
        )}
        <a
          href="/api/auth/login?returnTo=/profile"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-8 text-sm font-medium whitespace-nowrap text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
        >
          Sign in with F3 Nation
        </a>
      </CardContent>
    </Card>
  );
}
