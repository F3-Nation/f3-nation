import { RotateCcw } from "lucide-react";

import { Button } from "@acme/ui/button";

export const ResetFilter = ({ onClick }: { onClick: () => void }) => {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 rounded-full bg-muted hover:bg-muted/80"
      onClick={onClick}
      title="Reset Filters"
    >
      <RotateCcw className="size-5 shrink-0 opacity-50" />
    </Button>
  );
};
