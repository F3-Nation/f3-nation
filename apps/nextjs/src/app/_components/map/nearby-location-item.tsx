"use client";

import { useCallback } from "react";
import Link from "next/link";
import isNumber from "lodash/isNumber";

import { isProduction, RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";

import type { LocationMarkerWithDistance } from "./filtered-map-results-provider";
import { setView } from "~/utils/set-view";
import { appStore } from "~/utils/store/app";
import { searchStore } from "~/utils/store/search";
import {
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";
import { ImageWithFallback } from "../image-with-fallback";
import { EventChip } from "./event-chip";

const SHOW_ID = false;

export const NearbyLocationItem = (props: {
  item: LocationMarkerWithDistance;
}) => {
  RERENDER_LOGS && console.log("SelectedItem rerender");
  const searchBarRef = searchStore.use.searchBarRef();

  const eventId = selectedItemStore.use.eventId();
  const locationId = selectedItemStore.use.locationId();
  const ignoreNextNearbyItemMouseEnter =
    appStore.use.ignoreNextNearbyItemMouseEnter();
  const { item } = props;
  const isSelected = item.id === locationId;

  const handleClick = useCallback(
    ({
      locationId,
      eventId,
      clearSearch,
    }: {
      locationId: number;
      eventId: number | null;
      clearSearch: boolean;
    }) => {
      // Open panel first so that the centering to the marker is offset if needed
      setTimeout(() => {
        setSelectedItem({
          locationId,
          eventId,
          showPanel: true,
        });
      }, 250);
      if (item.lat !== null && item.lon !== null) {
        setView({ lat: item.lat, lng: item.lon });
        // prevent the next mouse enter from triggering a change
        appStore.setState({ ignoreNextNearbyItemMouseEnter: true });
      }
      if (clearSearch) {
        searchStore.setState({ shouldShowResults: false });
        searchBarRef.current?.blur();
      }
    },
    [item, searchBarRef],
  );

  const handleHover = useCallback(
    ({
      locationId,
      eventId,
    }: {
      locationId: number;
      eventId: number | null;
    }) => {
      setSelectedItem({
        locationId,
        eventId,
        showPanel: false,
      });
    },
    [],
  );

  const name = item.aoName;
  return (
    <button
      className={cn(
        "text-left text-sm text-foreground",
        // pl-1 balances the image on left and right
        "relative w-full cursor-pointer py-2 pl-1 pr-2",
        "bg-background",
        { "bg-muted": isSelected },
      )}
      // @RollOver (SoCo - St. Louis) & @Mr. Roboto (New Bern, NC) had issues with the mouse events we were using here
      // Likely everything needs to be condensed to onClick and onMouseEnter for handleClick and handleHover
      // Dell Precision Notebook
      onClick={(e) => {
        handleClick({
          locationId: item.id,
          eventId: null,
          clearSearch: true,
        });
        e.stopPropagation();
      }}
      onMouseEnter={(e) => {
        if (ignoreNextNearbyItemMouseEnter) {
          appStore.setState({ ignoreNextNearbyItemMouseEnter: false });
          return;
        }
        handleHover({
          locationId: item.id,
          eventId: null,
        });
        e.stopPropagation();
      }}
    >
      <div className="flex flex-row items-stretch gap-1">
        <div className="flex flex-shrink-0 flex-col items-center justify-center">
          <ImageWithFallback
            src={item.logo ? item.logo : "/f3_logo.png"}
            fallbackSrc="/f3_logo.png"
            loading="lazy"
            width={48}
            height={48}
            alt={item.logo ?? "F3 logo"}
            className="rounded-md bg-black" // many are white png
          />
        </div>
        {/* Use flex-col to stack items vertically */}
        <div className="flex w-full flex-col items-stretch justify-start overflow-hidden">
          <div className="flex w-full flex-1 flex-row items-center justify-between">
            <div className="-mt-[4px] line-clamp-1 pt-0 text-base font-bold leading-6">
              {name}
            </div>
            {isNumber(item.distance) ? (
              <div className="text-xs">
                <span className="text-foreground/40">
                  {!isProduction && SHOW_ID ? <div>({item.id})</div> : null}
                </span>
                <span className="font-bold">{item.distance?.toFixed(1)}mi</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-row flex-wrap gap-x-2 gap-y-1 ">
            {item.events.map((event) => {
              return (
                <EventChip
                  event={event}
                  key={event.id}
                  location={item}
                  size="small"
                  hideName
                  selected={event.id === eventId && item.id === locationId}
                  onClick={(e) => {
                    handleClick({
                      locationId: item.id,
                      eventId: event.id,
                      clearSearch: false,
                    });
                    e?.stopPropagation();
                  }}
                />
              );
            })}
          </div>
          <Link
            href={`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lon}`}
            target="_blank"
            className="mt-[2px] w-fit underline"
          >
            <p className="line-clamp-1 text-xs">
              {item.fullAddress ?? "Directions"}
            </p>
          </Link>
        </div>
      </div>
    </button>
  );
};
