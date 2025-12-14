import { Skeleton } from "@acme/ui/skeleton";

export const SelectedItemSkeleton = () => {
  return (
    <div className="flex min-h-[100px] w-full flex-col justify-between rounded-lg bg-background p-2 shadow">
      <div className="flex flex-row justify-between">
        <Skeleton className="h-[30px] w-[120px]" />
        <Skeleton className="h-[10px] w-[20px]" />
      </div>
      <div className="flex flex-row gap-1 pt-2">
        <Skeleton className="h-[64px] w-[64px]" />

        <div className="flex w-full flex-1 flex-col gap-1">
          <Skeleton className="h-[24px] w-[120px]" />
          <Skeleton className="h-[16px] w-full" />
          <Skeleton className="h-[16px] w-full" />
        </div>
      </div>
    </div>
  );
};
