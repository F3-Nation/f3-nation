import type { HTMLAttributes } from "react";
import { useState } from "react";

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
      className={cn("cursor-default text-gray-300", className)}
    >
      v{packageJson.version} ({channel}
      {commitHashString})
    </button>
  );
};
