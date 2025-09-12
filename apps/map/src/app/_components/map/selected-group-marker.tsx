"use client";

import { memo } from "react";
import { AdvancedMarker } from "@vis.gl/react-google-maps";

import { dayOfWeekToShortDayOfWeek } from "@acme/shared/app/functions";
import { cn } from "@acme/ui";

import type { SparseF3Marker } from "~/utils/types";
import { groupMarkerClick } from "~/utils/actions/group-marker-click";
import { isTouchDevice } from "~/utils/is-touch-device";
import {
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";

export const MemoSelectedGroupMarker = memo(
  ({
    group,
    selectedIndex,
    alwaysShowFillInsteadOfOutline,
    panel,
  }: {
    group: SparseF3Marker;
    selectedIndex: number;
    alwaysShowFillInsteadOfOutline?: boolean;
    panel?: boolean;
  }) => {
    console.log(
      "MemoSelectedGroupMarker",
      group,
      selectedIndex,
      alwaysShowFillInsteadOfOutline,
      panel,
    );
    const { lat, lon, events, id } = group;
    if (lat === null || lon === null) return null;
    const filteredEvents = events;

    return (
      <AdvancedMarker
        position={{ lat, lng: lon }}
        // clickable={false}
        // onMouseEnter={() => console.log("selected onMouseEnter")}
        onMouseLeave={() => {
          if (isTouchDevice()) return;
          if (selectedItemStore.get("locationId") !== id) return;
          setSelectedItem({
            locationId: null,
            eventId: null,
            showPanel: false,
          });
        }}
      >
        <div className="relative flex flex-col">
          <div
            className="flex flex-row rounded-full ring-[1px] ring-gray-700"
            style={{ zIndex: 1, width: `${filteredEvents.length * 30 + 4}px` }}
          >
            {filteredEvents.map((event, markerIdx, markerArray) => {
              const dotw = event.dayOfWeek;
              const isStart = markerIdx === 0;
              const isEnd = markerIdx === markerArray.length - 1;
              const dayText = dotw ? dayOfWeekToShortDayOfWeek(dotw) : null;
              return (
                <button
                  key={id + "-" + event.id}
                  onMouseEnter={() => {
                    if (isTouchDevice()) return;
                    const eventId = event.id;
                    setSelectedItem({
                      locationId: id,
                      ...(isNaN(eventId) ? {} : { eventId }),
                      showPanel: false,
                    });
                  }}
                  onClick={() => {
                    if (isTouchDevice()) return;
                    const eventId = event.id;
                    void groupMarkerClick({ locationId: id, eventId });
                  }}
                  className={cn(
                    "flex-1 cursor-pointer border-b-2 border-t-2 border-foreground bg-foreground py-2 text-center text-background",
                    "border-l-2 border-r-2",
                    `google-eventid-${event.id}`,
                    {
                      "rounded-r-full": isEnd,
                      "rounded-l-full": isStart,
                      "border-red-600 font-bold dark:bg-red-400":
                        selectedIndex === markerIdx,
                      "bg-red-600": true,
                      //   (!!panel || alwaysShowFillInsteadOfOutline) &&
                      //  (  selectedIndex === markerIdx || selectedIndex === -1 ),
                    },
                  )}
                >
                  {dayText}
                </button>
              );
            })}
          </div>
          <svg
            viewBox="0 0 40 40"
            className="-mt-[10.5px] w-[28px] self-center"
            style={{ zIndex: 0 }}
          >
            <path
              className={cn("fill-foreground", {
                "fill-[#dc2626] dark:fill-[#f87171]": false,
              })}
              d={
                filteredEvents.length === 1
                  ? "M34 10 L26 24.249 Q20 34.641 14 24.249 L6 10"
                  : "M34 14.5 L26 24.249 Q20 34.641 14 24.249 L6 14.5"
              }
              stroke="none"
            />
            <path
              d={
                filteredEvents.length === 1
                  ? "M34 10 L26 24.249 Q20 34.641 14 24.249 L6 10"
                  : "M34 15 L26 24.249 Q20 34.641 14 24.249 L6 15"
              }
              stroke="background"
              strokeWidth={0.5}
              fill="none"
            />
          </svg>
        </div>
      </AdvancedMarker>
    );
  },
  (prev, next) =>
    prev.panel === next.panel &&
    prev.group.lat === next.group.lat &&
    prev.group.lon === next.group.lon &&
    prev.group.id === next.group.id &&
    prev.group.events.length === next.group.events.length &&
    prev.selectedIndex === next.selectedIndex,
);

MemoSelectedGroupMarker.displayName = "MemoSelectedGroupMarker";
