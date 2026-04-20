import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { HEADER_HEIGHT } from "@acme/shared/app/constants";

import { cn } from "@acme/ui";

export default function AuthLayout(props: { children: ReactNode }) {
  return (
    <div className="flex max-h-dvh flex-col bg-muted">
      <div
        className="border-b-2 border-border bg-background py-2"
        style={{ height: HEADER_HEIGHT }}
      >
        <Link href="/" className="flex h-full items-center pl-4">
          <Image
            src="/f3_logo.png"
            alt="F3 Nation Logo"
            width={150}
            height={50}
            className="h-full w-auto object-contain"
          />
        </Link>
      </div>
      <div
        className={cn(
          "overflow-y-auto",
          "xs:p-8 xs:flex xs:flex-row xs:justify-center xs:items-start",
        )}
        style={{ height: `calc(100dvh - ${HEADER_HEIGHT}px)` }}
      >
        {props.children}
      </div>
    </div>
  );
}
