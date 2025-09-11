import { Info } from "lucide-react";

import { cn } from "@acme/ui";

import { ModalType, openModal } from "~/utils/store/modal";

export const InfoButton = ({ className }: { className?: string }) => {
  return (
    <div className={"flex flex-col lg:mx-2.5"}>
      <button
        className={cn(
          "cursor-pointer appearance-none overflow-hidden",
          "relative block",
          "h-10 w-10", // 40px x 40px
          "bg-background",
          "m-0 border-0 p-0",
          "user-select-none",
          "shadow-[0_1px_4px_-1px_rgba(0,0,0,0.3)]", // Google Maps shadow
          "flex items-center justify-center",
          // "rounded-sm", // Slight border radius (2px)
          className,
        )}
        onClick={() => {
          openModal(ModalType.ABOUT_MAP);
        }}
      >
        <Info
          strokeWidth={1.75}
          className={cn("size-7 text-muted-foreground")} // 28px x 28px with gray color
        />
      </button>
    </div>
  );
};
