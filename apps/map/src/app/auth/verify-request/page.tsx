import Image from "next/image";

import { VersionInfo } from "~/app/_components/version-info";
import { AuthWrapper } from "../components/auth-components";

export const dynamic = "force-dynamic";

export default function VerifyRequestPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center">
        <h2 className="mt-2 text-center text-3xl font-semibold">
          Check your email
        </h2>
      </div>
      <AuthWrapper className="pt-2 pb-8">
        <div className="flex flex-col items-center">
          <Image
            src="/f3_logo.png"
            alt="F3 Nation Logo"
            width={150}
            height={50}
            className="h-full object-contain"
          />

          <p className="mt-4 mb-6 text-lg leading-8 text-foreground">
            A sign in link has been sent to your email address.
          </p>

          <a
            href={"/"}
            className="text-base leading-8 text-muted-foreground no-underline hover:underline"
          >
            Back to the map
          </a>
        </div>
      </AuthWrapper>
      <div className="my-4 flex w-full justify-center">
        <VersionInfo />
      </div>
    </div>
  );
}
