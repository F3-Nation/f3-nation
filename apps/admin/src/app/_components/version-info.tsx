"use client";

import type { HTMLAttributes } from "react";

import { VersionInfo as VersionInfoBase } from "@acme/ui/version-info";

import { env } from "~/env";
import packageJson from "../../../package.json";

export const VersionInfo = (props: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <VersionInfoBase
      versionLabel={<span>v{packageJson.version}</span>}
      channel={env.NEXT_PUBLIC_CHANNEL}
      {...props}
    />
  );
};
