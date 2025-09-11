"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { Minus, Plus } from "lucide-react";

import { cn } from "@acme/ui";

export const ZoomButtons = () => {
  const map = useMap();
  return !map ? null : (
    <div className="flex flex-col lg:mx-2.5">
      <div className="flex flex-col overflow-hidden bg-white shadow-[0_1px_4px_-1px_rgba(0,0,0,0.3)]">
        {/* First button */}
        <button
          draggable="false"
          aria-label="Settings"
          title="Settings"
          type="button"
          className={cn(
            "cursor-pointer appearance-none",
            "relative block",
            "h-10 w-10",
            "m-0 border-0 p-0",
            "user-select-none",
            "flex items-center justify-center",
          )}
          onClick={() => {
            const zoom = map.getZoom();
            if (zoom == null) return;
            map.setZoom(zoom + 1);
          }}
        >
          <Plus strokeWidth={1.75} className={cn("size-7 text-[#666]")} />
        </button>

        {/* Dividing line that doesn't go full width */}
        <div className="mx-auto w-6 border-t border-gray-300"></div>

        {/* Second button */}
        <button
          draggable="false"
          aria-label="Second Action"
          title="Second Action"
          type="button"
          className={cn(
            "cursor-pointer appearance-none",
            "relative block",
            "h-10 w-10",
            "m-0 border-0 p-0",
            "user-select-none",
            "flex items-center justify-center",
          )}
          onClick={() => {
            const zoom = map.getZoom();
            if (zoom == null) return;
            map.setZoom(zoom - 1);
          }}
        >
          <Minus strokeWidth={1.75} className={cn("size-7 text-[#666]")} />
        </button>
      </div>
    </div>
  );
};
