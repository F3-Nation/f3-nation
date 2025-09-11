// Must disable these since we can't use a button in a button
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

"use client";

import { useCallback } from "react";

import type { DayOfWeek } from "@acme/shared/app/enums";
import { cn } from "@acme/ui";

import { getWhenFromWorkout } from "~/utils/get-when-from-workout";
import { setView } from "~/utils/set-view";
import { setSelectedItem } from "~/utils/store/selected-item";
import BootSvgComponent from "../SVGs/boot-camp";
import RuckSvgComponent from "../SVGs/ruck";
import RunSvgComponent from "../SVGs/run";

export const EventChip = (props: {
  variant?: "interactive" | "non-interactive";
  size?: "small" | "medium" | "large";
  selected?: boolean;
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  event: {
    name?: string;
    dayOfWeek: DayOfWeek | null;
    startTime: string | null;
    endTime?: string | null;
    id: number;
    locationId?: number | null;
    eventTypes: { id: number; name: string }[];
  };
  location: {
    id: number | null;
    lat: number | null;
    lon: number | null;
  };
  hideName?: boolean;
}) => {
  const {
    event,
    location,
    size = "medium",
    selected,
    variant = "interactive",
  } = props;

  const iconSize = size === "small" ? 16 : size === "medium" ? 16 : 24;

  const isInteractive = variant === "interactive";

  const name =
    event.name && !props.hideName ? (
      <>
        <b>{event.name}</b> -
      </>
    ) : null;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (props.onClick) {
        props.onClick();
      } else {
        setSelectedItem({
          locationId: event.locationId,
          eventId: event.id,
          showPanel: true,
        });
        if (location.lat !== null && location.lon !== null) {
          setView({ lat: location.lat, lng: location.lon });
        }
      }
      e.stopPropagation();
    },
    [event.id, event.locationId, location.lat, location.lon, props],
  );

  const handleHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setSelectedItem({
        locationId: event.locationId,
        eventId: event.id,
        showPanel: false,
      });
      e.stopPropagation();
    },
    [event.id, event.locationId],
  );

  const when = getWhenFromWorkout({
    dayOfWeek: event.dayOfWeek,
    startTime: event.startTime,
    endTime: event.endTime,
    condensed: true,
  });

  return (
    <div
      key={event.id}
      className={cn(
        "flex flex-row items-center ",
        "rounded-sm",
        "text-xs text-white",
        "px-2 shadow",
        "cursor-pointer",
        { "pointer-events-none bg-muted": !isInteractive },
        { "bg-red-600": isInteractive && selected },
        { "bg-muted": isInteractive && !selected },
        { "gap-1 py-[1px]": size === "small" },
        { "gap-1 py-[2px]": size === "medium" },
        { "gap-2 py-[3px]": size === "large" },
      )}
      onMouseEnter={handleHover}
      onClick={handleClick}
    >
      <div
        className={cn("flex flex-1 gap-2 text-foreground", {
          "text-base": size === "large",
          "text-background": selected && isInteractive,
          "justify-start": size === "small",
          "justify-center": size !== "small",
        })}
      >
        {name ? (
          <div className="line-clamp-1 whitespace-break-spaces text-left">
            {name}
          </div>
        ) : null}
        <div className="line-clamp-1 flex-shrink-0 text-left">
          {when || "No time"}
        </div>
      </div>
      <div>
        {event.eventTypes.some((et) => et.name === "Bootcamp") ? (
          <BootSvgComponent
            height={iconSize}
            width={iconSize}
            fill={selected && isInteractive ? "background" : undefined}
          />
        ) : event.eventTypes.some((et) => et.name === "Ruck") ? (
          <RuckSvgComponent
            height={iconSize}
            width={iconSize}
            fill={selected && isInteractive ? "background" : undefined}
          />
        ) : event.eventTypes.some((et) => et.name === "Run") ? (
          <RunSvgComponent
            height={iconSize}
            width={iconSize}
            fill={selected && isInteractive ? "background" : undefined}
          />
        ) : null}
      </div>
      {/* Show a +badge if there are more than 1 event type */}
      {event.eventTypes.length > 1 ? (
        <div
          className={cn(
            "flex size-3 items-center justify-center rounded-full bg-background text-foreground",
            { "-ml-4 -mt-3 size-4 text-sm": size === "large" },
            { "-ml-[10px] -mt-[6px] size-3 text-xs ": size === "medium" },
            { "-ml-[8px] -mt-[6px] size-[10px] text-xs ": size === "small" },
          )}
        >
          +
        </div>
      ) : null}
    </div>
  );
};
