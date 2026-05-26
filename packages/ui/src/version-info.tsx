"use client";

import type { HTMLAttributes, ReactNode } from "react";

import { cn } from ".";

export interface VersionInfoProps extends HTMLAttributes<HTMLSpanElement> {
  channel: string;
  commitHash?: string | null;
  versionLabel: ReactNode;
}

export const VersionInfo = ({
  channel,
  commitHash,
  versionLabel,
  className,
  ...rest
}: VersionInfoProps) => {
  const commitHashString = commitHash ? ` (${commitHash})` : "";

  return (
    <span className={cn("inline-flex items-center gap-1", className)} {...rest}>
      {versionLabel}
      <span className="cursor-default">
        ({channel}
        {commitHashString})
      </span>
    </span>
  );
};
