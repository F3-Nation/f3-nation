"use client";

import type { HTMLAttributes } from "react";
import { useState } from "react";
import Link from "next/link";

import { VersionInfo as VersionInfoBase } from "@acme/ui/version-info";

import { useRuntimeConfig } from "~/utils/runtime-config";
import { mapStore } from "~/utils/store/map";
import packageJson from "../../../package.json";

export const VersionInfo = (props: HTMLAttributes<HTMLSpanElement>) => {
  const { channel } = useRuntimeConfig();
  const [clicks, setClicks] = useState(0);

  return (
    <VersionInfoBase
      channel={channel}
      versionLabel={
        <Link
          href="/changelog"
          className="cursor-pointer text-blue-600 underline underline-offset-2 hover:text-blue-800"
        >
          v{packageJson.version}
        </Link>
      }
      onChannelClick={() => {
        setClicks(clicks + 1);
        if (clicks > 10) {
          mapStore.setState({ showDebug: true });
        }
      }}
      {...props}
    />
  );
};
