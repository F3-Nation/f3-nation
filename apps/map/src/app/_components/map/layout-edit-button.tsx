"use client";

import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { Edit } from "lucide-react";
import { useSession } from "next-auth/react";

import { cn } from "@acme/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@acme/ui/tooltip";

import { appStore } from "~/utils/store/app";
import { ModalType, openModal } from "~/utils/store/modal";

export const LayoutEditButton = ({
  className,
  ...rest
}: DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>) => {
  const { data: session } = useSession();
  const mode = appStore.use.mode();

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={() => {
          if (session) {
            if (mode === "edit") {
              appStore.setState({ mode: "view" });
            } else {
              appStore.setState({ mode: "edit" });
            }
          } else {
            openModal(ModalType.SIGN_IN, {
              message: "You must log in to edit the map",
            });
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
              {
                "rounded-sm bg-blue-500 text-white": mode === "edit",
                "bg-background": mode !== "edit",
              },
              "m-0 border-0 p-0",
              "user-select-none",
              "shadow-[0_1px_4px_-1px_rgba(0,0,0,0.3)]", // Google Maps shadow
              "flex items-center justify-center",
              className,
            )}
            {...rest}
          >
            <Edit
              strokeWidth={1.75}
              className={cn("size-7", {
                "text-white": mode === "edit",
                "text-muted-foreground": mode !== "edit",
              })}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="mr-4 flex max-w-80 flex-col gap-2">
        {mode === "edit" ? (
          <div className="text-sm">
            <p className="font-bold">Edit mode is on</p>
            <p>• Click on a workout to see edit options</p>
            <p>• Drag markers to move workouts to new locations</p>
            <p>
              • Click on the map to place a pin and see options for adding a new
              location
            </p>
            <p>
              • Be sure to submit your changes! If you are not an admin or
              editor for the region, your changes will be sent to an admin for
              approval.
            </p>
          </div>
        ) : (
          <>
            <p>Make edits to the map</p>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
};
