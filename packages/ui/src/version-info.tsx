"use client";

import type { HTMLAttributes, ReactNode } from "react";

import { cn } from ".";

export interface VersionInfoProps extends HTMLAttributes<HTMLSpanElement> {
  channel: string;
  commitHash?: string | null;
  versionLabel: ReactNode;
  onChannelClick?: () => void;
}

export const VersionInfo = ({
  channel,
  commitHash,
  versionLabel,
  onChannelClick,
  className,
  ...rest
}: VersionInfoProps) => {
  const commitHashString = commitHash ? ` (${commitHash})` : "";

  return (
    <span className={cn("inline-flex items-center gap-1", className)} {...rest}>
      {versionLabel}
      {onChannelClick ? (
        <button
          type="button"
          onClick={onChannelClick}
          className="cursor-default"
        >
          ({channel}
          {commitHashString})
        </button>
      ) : (
        <span className="cursor-default">
          ({channel}
          {commitHashString})
        </span>
      )}
    </span>
  );
};
