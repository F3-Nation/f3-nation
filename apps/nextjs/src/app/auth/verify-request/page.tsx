"use client";

import Image from "next/image";

import { VersionInfo } from "~/app/_components/version-info";
import { env } from "~/env";
import { AuthWrapper } from "../components/auth-components";

export default function VerifyRequestPage() {
  const url = new URL(env.NEXT_PUBLIC_URL);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center">
        <h2 className="mt-2 text-center text-3xl font-semibold">
          Check your email
        </h2>
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

          <p className="mb-6 mt-4 text-lg leading-8 text-foreground">
            A sign in link has been sent to your email address.
          </p>

          <a
            href={url.toString()}
            className="text-base leading-8 text-muted-foreground no-underline hover:underline"
          >
            {url.host}
          </a>
        </div>
      </AuthWrapper>
      <VersionInfo className="my-4 w-full text-center" />
    </div>
  );
}
