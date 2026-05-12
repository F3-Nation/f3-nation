"use client";

import type { ReactNode } from "react";

import { cn } from "@acme/ui";

import { navigateToSsoLogin } from "~/lib/auth/client";

export interface SignInComponentProps {
  callbackUrl?: string;
}

export const AuthWrapper = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-1 flex-col items-center bg-background p-8 pb-16 text-center",
        "xs:w-min xs:min-w-[400px] xs:shadow-md xs:rounded-xl xs:pb-8 xs:flex-grow-0 xs:h-auto",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const Loading = ({ text }: { text: string }) => {
  return (
    <div className="flex h-32 w-full flex-col items-center justify-center gap-4">
      <p className="text-center text-lg text-muted-foreground">{text}</p>
    </div>
  );
};

export const AuthContent = ({
  callbackUrl,
  withWrapper = true,
}: SignInComponentProps & { withWrapper?: boolean }) => {
  const content = (
    <div className="w-full">
      <p className="text-sm text-muted-foreground">
        Continue with your F3 Nation account to access the admin portal.
      </p>
      <button
        type="button"
        onClick={() => navigateToSsoLogin(callbackUrl ?? "/")}
        className="mt-4 flex w-full cursor-pointer justify-center rounded-md bg-foreground px-4 py-2 text-background"
      >
        Sign in with F3 SSO
      </button>
    </div>
  );

  return withWrapper ? (
    <AuthWrapper className="py-6">{content}</AuthWrapper>
  ) : (
    content
  );
};
