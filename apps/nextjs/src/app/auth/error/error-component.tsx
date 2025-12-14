"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";

import { VersionInfo } from "~/app/_components/version-info";
import { env } from "~/env";
import { AuthWrapper } from "../components/auth-components";

type Error = "default" | "Configuration" | "AccessDenied" | "Verification";

export default function ErrorComponent() {
  const searchParams = useSearchParams();
  const error = searchParams?.get("error") ?? "default";
  const url = new URL(env.NEXT_PUBLIC_MAP_URL);

  const errors: Record<
    Error,
    { heading: string; message: React.ReactNode; signin?: React.ReactNode }
  > = {
    default: {
      heading: "Error",
      message: (
        <>
          <p>An error occurred while signing in. Please try again.</p>
          <a href={url.origin} className="hover:underline">
            {url.host}
          </a>
        </>
      ),
    },
    Configuration: {
      heading: "Server error",
      message: (
        <div>
          <p>There is a problem with the server configuration.</p>
          <p>Check the server logs for more information.</p>
        </div>
      ),
    },
    AccessDenied: {
      heading: "Access Denied",
      message: (
        <div>
          <p>You do not have permission to sign in.</p>
          <p>
            <a href="/auth/signin" className="hover:underline">
              Sign in
            </a>
          </p>
        </div>
      ),
    },
    Verification: {
      heading: "Unable to sign in",
      message: (
        <div>
          <p>The sign in link is no longer valid.</p>
          <p>It may have been used already or it may have expired.</p>
        </div>
      ),
      signin: (
        <a href="/auth/signin" className="hover:underline">
          Sign in
        </a>
      ),
    },
  };

  const { heading, message, signin } =
    errors[error as keyof typeof errors] ?? errors.default;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center">
        <h2 className="mt-2 text-center text-3xl font-semibold">{heading}</h2>
      </div>
      <AuthWrapper className="pb-8 pt-2">
        <div className="flex flex-col items-center">
          <Image
            src="/f3_logo.png"
            alt="F3 Nation Logo"
            width={150}
            height={50}
            className="h-full object-contain"
          />

          <div className="mb-6 mt-4 text-lg leading-8 text-foreground">
            {message}
          </div>

          {signin && (
            <div className="text-base leading-8 text-muted-foreground">
              {signin}
            </div>
          )}
        </div>
      </AuthWrapper>
      <VersionInfo className="my-4 w-full text-center" />
    </div>
  );
}
