import type { HTMLAttributes } from "react";
import { useState } from "react";
import Link from "next/link";

import { cn } from "@acme/ui";

import { env } from "~/env";
import { mapStore } from "~/utils/store/map";
import packageJson from "../../../package.json";

export const VersionInfo = (props: HTMLAttributes<HTMLButtonElement>) => {
  const [clicks, setClicks] = useState(0);
  const { className, ...rest } = props;
  const channel = env.NEXT_PUBLIC_CHANNEL;
  const commitHashString = env.NEXT_PUBLIC_GIT_COMMIT_HASH
    ? ` (${env.NEXT_PUBLIC_GIT_COMMIT_HASH})`
    : "";

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
        ({channel}
        {commitHashString})
      </button>
    </span>
  );
};
