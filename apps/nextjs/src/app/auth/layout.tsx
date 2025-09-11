import type { ReactNode } from "react";
import { HEADER_HEIGHT } from "node_modules/@acme/shared/src/app/constants";

import { cn } from "@acme/ui";

import { Logo } from "../_components/logo";

export default function AuthLayout(props: { children: ReactNode }) {
  return (
    // Flex col to allow for main to take up rest of page (100% makes it overflow)
    <div className="flex max-h-dvh flex-col bg-muted">
      <div
        className="border-b-2 border-border bg-background py-2"
        style={{ height: HEADER_HEIGHT }}
      >
        <Logo />
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
