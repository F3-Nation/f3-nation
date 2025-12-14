import { Skeleton } from "@acme/ui/skeleton";

export const DesktopNearbyLocationItemSkeleton = () => {
  return (
    <Skeleton className="flex min-h-[160px] w-full flex-col justify-between bg-transparent p-4">
      <div className="flex flex-row justify-between">
        <Skeleton className="h-[30px] w-[120px]" />
        <Skeleton className="h-[10px] w-[20px]" />
      </div>
      <div className="flex flex-row pt-2">
        <div className="flex w-[80px] flex-col items-center justify-start gap-1">
          <Skeleton className="h-[48px] w-[48px]" />
          <Skeleton className="h-[10px] w-[48px]" />
          <Skeleton className="h-[10px] w-[48px]" />
        </div>

        <div className="flex w-full flex-col gap-1">
          <Skeleton className="h-[24px] w-[120px]" />
          <Skeleton className="h-[16px] w-full" />
          <Skeleton className="h-[32px] w-full" />
        </div>
      </div>
    </Skeleton>
  );
};
