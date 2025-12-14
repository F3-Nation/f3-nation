import { cn } from "@acme/ui";
import { CardDescription, CardHeader, CardTitle } from "@acme/ui/card";

import type { F3LocationMapSearchResult } from "~/utils/types";
import { isTouchDevice } from "~/utils/is-touch-device";
import { setView } from "~/utils/set-view";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import { searchStore } from "~/utils/store/search";
import { setSelectedItem } from "~/utils/store/selected-item";
import { ImageWithFallback } from "../image-with-fallback";

export const onClickPlaceRowF3Location = (
  result: F3LocationMapSearchResult,
) => {
  console.log("onClickPlaceRowF3", result);
  searchStore.setState({ shouldShowResults: false });
  appStore.setState({ ignoreNextNearbyItemMouseEnter: true });
  const latitude = result.destination.lat;
  const longitude = result.destination.lng;
  if (typeof latitude === "number" && typeof longitude === "number") {
    mapStore.setState({
      nearbyLocationCenter: {
        lat: latitude,
        lng: longitude,
        name: result.header,
        type: "search",
      },
    });
    setView({ lat: latitude, lng: longitude });
    // Use a timeout to allow the map animation to finish
    setTimeout(() => {
      setSelectedItem({
        locationId: result.destination.item.locationId,
        eventId: result.destination.item.eventId,
        showPanel: false,
      });
    }, 250);
  }
};

export const PlaceRowF3Location = ({
  result,
  focused,
}: {
  result: F3LocationMapSearchResult;
  focused?: boolean;
}) => {
  return (
    <button
      className="w-full"
      onMouseOver={() => {
        const touchDevice = isTouchDevice();
        if (touchDevice) {
          onClickPlaceRowF3Location(result);
        } else {
          setSelectedItem({
            locationId: result.destination.item.locationId,
            eventId: result.destination.item.eventId,
            showPanel: false,
          });
        }
      }}
      onFocus={() => {
        setSelectedItem({
          locationId: result.destination.item.locationId,
          eventId: result.destination.item.eventId,
          showPanel: false,
        });
      }}
      onClick={() => {
        onClickPlaceRowF3Location(result);
      }}
    >
      <CardHeader
        className={cn("flex-row items-center gap-2 p-2 hover:bg-foreground/5", {
          "bg-foreground/5": focused,
        })}
      >
        <ImageWithFallback
          loading="lazy"
          src={result.destination.logo || "/f3_logo.png"}
          fallbackSrc="/f3_logo.png"
          width={32}
          height={32}
          alt="item"
          className="rounded-sm bg-black"
        />
        <div className="flex-4 text-start">
          <CardTitle>{result.header}</CardTitle>
          <CardDescription className="line-clamp-1">
            Workout
            {result.destination.regionName ? (
              <span> (F3 {result.destination.regionName})</span>
            ) : null}
          </CardDescription>
        </div>
      </CardHeader>
    </button>
  );
};
