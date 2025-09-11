import { Loader2 } from "lucide-react";

import { cn } from ".";

export const Loader = ({ className }: { className?: string }) => {
  return (
    <Loader2
      className={cn("size-16 animate-spin text-foreground/60", className)}
    />
  );
};
