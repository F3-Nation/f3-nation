"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { Globe2 } from "lucide-react";

import { cn } from "@acme/ui";

export const CountryZoomButton = ({ className }: { className?: string }) => {
  const map = useMap();
  return (
    <div className={"flex flex-col lg:mx-2.5"}>
      <button
        draggable="false"
        aria-label="Country Zoom"
        title="Country Zoom"
        type="button"
        className={cn(
          "cursor-pointer appearance-none overflow-hidden",
          "relative block",
          "h-10 w-10", // 40px x 40px
          "bg-white",
          "m-0 border-0 p-0",
          "user-select-none",
          "shadow-[0_1px_4px_-1px_rgba(0,0,0,0.3)]", // Google Maps shadow
          "flex items-center justify-center",
          // "rounded-sm", // Slight border radius (2px)
          className,
        )}
        onClick={() => {
          map?.setZoom(4);
        }}
      >
        <Globe2
          strokeWidth={1.75}
          className={cn("size-7 text-[#666]")} // 28px x 28px with gray color
        />
      </button>
    </div>
  );
};
