import { Trash } from "lucide-react";

import { cn } from "@acme/ui";

export const DeletedWorkoutWarning = ({ text }: { text: string }) => {
  return (
    <div className="p-4">
      <div
        role="alert"
        className={cn(
          "rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-amber-950",
          "dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100",
        )}
      >
        <div className="flex items-start gap-3">
          <Trash className="mt-0.5 size-4 shrink-0" />
          <div className="text-sm font-semibold">{text}</div>
        </div>
      </div>
    </div>
  );
};
