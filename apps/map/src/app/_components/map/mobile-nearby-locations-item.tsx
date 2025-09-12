"use client";

import isNumber from "lodash/isNumber";

import { MOBILE_SEARCH_RESULT_ITEM_HEIGHT } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { onlyUnique } from "@acme/shared/common/functions";
import { cn } from "@acme/ui";

import type { LocationMarkerWithDistance } from "./filtered-map-results-provider";
import { useSearchResultSize } from "~/utils/hooks/use-search-result-size";
import { setView } from "~/utils/set-view";
import { searchStore } from "~/utils/store/search";
import {
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";
import { ImageWithFallback } from "../image-with-fallback";
import { EventChip } from "./event-chip";

export const MobileNearbyLocationsItem = (props: {
  searchResult: LocationMarkerWithDistance;
}) => {
  RERENDER_LOGS && console.log("SelectedItem rerender");
  const { itemWidth } = useSearchResultSize();
  const searchBarRef = searchStore.use.searchBarRef();

  const locationId = selectedItemStore.use.locationId();
  const { searchResult } = props;
  const isSelected = searchResult.id === locationId;

  const name = searchResult.events
    .map((event) => event.name)
    .filter(onlyUnique)
    .join(", ");

  return (
    <button
      style={{ width: itemWidth, height: MOBILE_SEARCH_RESULT_ITEM_HEIGHT }}
      className={cn(
        "relative cursor-pointer overflow-clip rounded-md bg-background",
        "flex flex-col justify-start",
        "text-left text-sm text-foreground",
        "flex-shrink-0",
        "p-2",
        "h-32",
        "border-2 border-foreground/10",
        { "border-red-500": isSelected },
      )}
      onClick={() => {
        searchBarRef.current?.blur();
        setSelectedItem({
          locationId: searchResult.id,
          eventId: searchResult.events[0]?.id,
          showPanel: true,
        });
        if (searchResult.lat !== null && searchResult.lon !== null) {
          setView({ lat: searchResult.lat, lng: searchResult.lon });
        }
      }}
    >
      <div className="flex w-full flex-row items-center justify-between">
        <div className="line-clamp-1 text-lg font-bold">{name}</div>
        {isNumber(searchResult.distance) && searchResult.distance > 0.05 ? (
          <div className="text-xs text-foreground/40">
            {searchResult.distance?.toFixed(1)}mi
          </div>
        ) : null}
      </div>
      <div className="flex flex-row items-start gap-2">
        <button
          className="flex flex-shrink-0 flex-col items-center"
          onClick={() => {
            setSelectedItem({ locationId: searchResult.id, showPanel: true });
          }}
        >
          <ImageWithFallback
            src={searchResult.logo ? searchResult.logo : "/f3_logo.png"}
            fallbackSrc="/f3_logo.png"
            loading="lazy"
            width={48}
            height={48}
            alt={searchResult.logo ?? "F3 logo"}
            className="rounded-md bg-black"
          />
          <p className="cursor-pointer text-center text-xs text-blue-500 underline">
            More details
          </p>
        </button>
        {/* Use flex-col to stack items vertically */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex flex-row flex-wrap gap-x-2 gap-y-1 ">
            {searchResult.events.map((event) => {
              return (
                <EventChip
                  key={event.id}
                  selected={false}
                  size="small"
                  event={event}
                  location={searchResult}
                />
              );
            })}
          </div>
        </div>
      </div>
    </button>
  );
};
