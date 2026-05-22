"use client";

import type { HTMLAttributes } from "react";

import { VersionInfo as VersionInfoBase } from "@acme/ui/version-info";

import packageJson from "../../../package.json";

interface VersionInfoProps extends HTMLAttributes<HTMLSpanElement> {
  channel: string;
}

export const VersionInfo = ({ channel, ...props }: VersionInfoProps) => {
  return (
    <VersionInfoBase
      versionLabel={<span>v{packageJson.version}</span>}
      channel={channel}
      {...props}
    />
  );
};
