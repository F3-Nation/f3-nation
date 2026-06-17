"use client";

import { useSearchParams } from "next/navigation";

import { VersionInfo } from "~/app/_components/version-info";
import { AuthContent } from "../components/auth-components";

export const SignIn = ({ channel }: { channel: string }) => {
  const searchParams = useSearchParams();
  const callbackUrl =
    searchParams.get("callbackUrl") ?? searchParams.get("returnTo") ?? "/";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col items-center">
        <h2 className="mt-2 text-center text-3xl font-semibold">
          Sign in to F3 Nation Admin
        </h2>
      </div>
      <AuthContent callbackUrl={callbackUrl} withWrapper={true} />
      <div className="my-4 flex w-full justify-center">
        <VersionInfo channel={channel} />
      </div>
    </div>
  );
};
