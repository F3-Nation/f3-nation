"use client";

import type { HTMLAttributes } from "react";
import { useState } from "react";
import Link from "next/link";

import { cn } from "@acme/ui";

import { useRuntimeConfig } from "~/utils/runtime-config";
import { mapStore } from "~/utils/store/map";
import packageJson from "../../../package.json";

export const VersionInfo = (props: HTMLAttributes<HTMLSpanElement>) => {
  const { channel } = useRuntimeConfig();
  const [clicks, setClicks] = useState(0);
  const { className, ...rest } = props;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Link
        href="/changelog"
        className="cursor-pointer text-blue-600 underline underline-offset-2 hover:text-blue-800"
      >
        v{packageJson.version}
      </Link>
      <button
        {...rest}
        onClick={() => {
          setClicks(clicks + 1);
          if (clicks > 10) {
            mapStore.setState({
              showDebug: true,
            });
          }
        }}
        className="cursor-default"
      >
        ({channel})
      </button>
    </span>
  );
};
