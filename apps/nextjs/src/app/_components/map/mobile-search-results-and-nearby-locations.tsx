import { useRef, useState } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";
import { Checkbox } from "@acme/ui/checkbox";
import { Label } from "@acme/ui/label";

import { searchStore } from "~/utils/store/search";
import {
  isF3LocationMapSearchResult,
  isF3RegionMapSearchResult,
  isGeoMapSearchResult,
} from "~/utils/types";
import { useFilteredMapResults } from "./filtered-map-results-provider";
import { NearbyLocationItem } from "./nearby-location-item";
import { PlaceRowF3Location } from "./place-row-f3-location";
import { PlaceRowF3Region } from "./place-row-f3-region";
import { PlaceRowMap } from "./place-row-map";
import { useTextSearchResults } from "./search-results-provider";

export const MobileSearchResultsAndNearbyLocations = () => {
  RERENDER_LOGS && console.log("MapDrawer rerender");
  const shouldShowResults = searchStore.use.shouldShowResults();
  const text = searchStore.use.text();
  const { combinedResults } = useTextSearchResults();
  const { locationOrderedLocationMarkers } = useFilteredMapResults();
  const checkboxContainerRef = useRef<HTMLDivElement>(null);
  const [showResults, setShowResults] = useState({
    location: true,
    region: true,
    geo: true,
  });

  RERENDER_LOGS && console.log("SelectedItem rerender");

  // Reset state when the ordered location markers change
  if (!shouldShowResults) return null;
  return (
    <div
      style={{ zIndex: Z_INDEX.MOBILE_SEARCH_RESULTS }}
      className={cn(
        "absolute bottom-0 left-0 right-0 flex h-full flex-col-reverse divide-y overflow-y-auto bg-background",
      )}
    >
      <div className="h-14 w-full flex-shrink-0 bg-background" />
      {text ? (
        <>
          <div
            ref={checkboxContainerRef}
            className="border-b border-gray-200 pt-3"
          >
            <div className="flex flex-row justify-center gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show-locations"
                  checked={showResults.location}
                  onCheckedChange={(checked) => {
                    // inputRef.current?.focus(); // focus so blur will call next time
                    setShowResults((prev) => ({
                      ...prev,
                      location: checked === true,
                    }));
                  }}
                />
                <Label htmlFor="show-locations">F3 Workouts</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show-regions"
                  checked={showResults.region}
                  onCheckedChange={(checked) => {
                    // inputRef.current?.focus(); // focus so blur will call next time
                    setShowResults((prev) => ({
                      ...prev,
                      region: checked === true,
                    }));
                  }}
                />
                <Label htmlFor="show-regions">F3 Regions</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show-geo"
                  checked={showResults.geo}
                  onCheckedChange={(checked) => {
                    // inputRef.current?.focus(); // focus so blur will call next time
                    setShowResults((prev) => ({
                      ...prev,
                      geo: checked === true,
                    }));
                  }}
                />
                <Label htmlFor="show-geo">Places</Label>
              </div>
            </div>
          </div>
          {combinedResults
            .filter((result) => {
              if (showResults.location && isF3LocationMapSearchResult(result)) {
                return true;
              }
              if (showResults.region && isF3RegionMapSearchResult(result)) {
                return true;
              }
              if (showResults.geo && isGeoMapSearchResult(result)) {
                return true;
              }
              return false;
            })
            .map((result, index) =>
              isF3LocationMapSearchResult(result) ? (
                <PlaceRowF3Location
                  key={result.destination.id}
                  result={result}
                />
              ) : isF3RegionMapSearchResult(result) ? (
                <PlaceRowF3Region key={result.destination.id} result={result} />
              ) : (
                <PlaceRowMap
                  key={result.destination.id}
                  result={result}
                  focused={index === 0}
                />
              ),
            )}
        </>
      ) : (
        locationOrderedLocationMarkers
          ?.slice(0, 15)
          .map((result) => <NearbyLocationItem key={result.id} item={result} />)
      )}
    </div>
  );
};
