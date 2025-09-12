import Link from "next/link";
import { HelpCircle } from "lucide-react";

import { filterButtonClassName } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

export const HelpButton = () => {
  return (
    <div className="m-2">
      <Link
        href="/help?back=%2Fmap"
        className={cn(
          filterButtonClassName,
          "flex w-auto whitespace-nowrap bg-foreground text-background",
        )}
      >
        <HelpCircle strokeWidth={2} className={cn("size-4")} />
        <div className="whitespace-nowrap">Help / feedback</div>
      </Link>
    </div>
  );
};
