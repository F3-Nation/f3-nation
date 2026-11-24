import { CircleQuestionMark } from "lucide-react";
import Link from "next/link";

import { cn } from "@acme/ui";

export const HelpButton = ({ className }: { className?: string }) => {
  return (
    <div className={cn("m-2.5", className)}>
      <Link
        href="/help?back=%2Fmap"
        className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-bold whitespace-nowrap text-foreground shadow-sm transition-colors hover:bg-muted"
      >
        <CircleQuestionMark aria-hidden strokeWidth={2} className="size-3.5" />
        Help / feedback
      </Link>
    </div>
  );
};
