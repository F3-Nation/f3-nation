"use client";

import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { LocateFixed } from "lucide-react";

import { cn } from "@acme/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@acme/ui/tooltip";

import { isTouchDevice } from "~/utils/is-touch-device";
import { ModalType, openModal } from "~/utils/store/modal";
import { UserLocationContent } from "../modal/user-location-content";
import { useUserLocation } from "./user-location-provider";

export const UserLocationIcon = ({
  className,
  ...rest
}: DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>) => {
  const { attemptToNavigateToUserLocation, status, permissions } =
    useUserLocation();

  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger
        onClick={() => {
          const touchDevice = isTouchDevice();
          if (touchDevice && status !== "success") {
            openModal(ModalType.USER_LOCATION_INFO);
          } else {
            void attemptToNavigateToUserLocation();
          }
        }}
      >
        <div className={"flex flex-col lg:mx-2.5"}>
          <div
            aria-label="My Location"
            title="My Location"
            className={cn(
              "cursor-pointer appearance-none overflow-hidden",
              "relative block",
              "h-10 w-10", // 40px x 40px
              "bg-background",
              "m-0 border-0 p-0",
              "user-select-none",
              "shadow-[0_1px_4px_-1px_rgba(0,0,0,0.3)]", // Google Maps shadow
              "flex items-center justify-center",
              className,
            )}
            {...rest}
          >
            <div
              className={cn({
                "animate-spin":
                  permissions !== "denied" && status === "loading",
              })}
            >
              <LocateFixed
                strokeWidth={1.75}
                className={cn("size-7", {
                  "text-muted": permissions === "denied",
                  "text-muted-foreground": permissions !== "denied",
                })} // Matching the Settings icon style
              />
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="mr-4 flex max-w-40 flex-col gap-2">
        <UserLocationContent allowInteraction={false} />
      </TooltipContent>
    </Tooltip>
  );
};
