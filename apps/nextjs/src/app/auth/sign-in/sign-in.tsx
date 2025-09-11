"use client";

import type { SignInComponentProps } from "../components/auth-components";
import { VersionInfo } from "~/app/_components/version-info";
import { AuthContent } from "../components/auth-components";

export const SignIn = (params: SignInComponentProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center">
        <h2 className="mt-2 text-center text-3xl font-semibold">
          {"Sign in to F3 Nation"}
        </h2>
      </div>
      <AuthContent callbackUrl={params.callbackUrl} withWrapper={true} />
      <VersionInfo className="my-4 w-full text-center" />
    </div>
  );
};
