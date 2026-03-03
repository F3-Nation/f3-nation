"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AuthCardProps {
  error?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "Please sign in to continue.",
  csrf_mismatch: "Security validation failed. Please try again.",
  state_expired: "Login session expired. Please try again.",
  callback_failed: "Authentication failed. Please try again.",
  missing_params: "Invalid authentication response. Please try again.",
};

export function AuthCard({ error }: AuthCardProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <text
              x="16"
              y="16"
              textAnchor="middle"
              dominantBaseline="central"
              fill="currentColor"
              fontFamily="sans-serif"
              fontWeight="bold"
              fontSize="14"
            >
              F3
            </text>
          </svg>
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
          className="inline-flex h-11 w-full items-center justify-center whitespace-nowrap rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Sign in with F3 Nation
        </a>
      </CardContent>
    </Card>
  );
}
