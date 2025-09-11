import { cn } from "@acme/ui";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-foreground/20", className)}
      {...props}
    />
  );
}

export { Skeleton };
