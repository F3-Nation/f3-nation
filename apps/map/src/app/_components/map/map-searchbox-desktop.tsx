"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, XCircle } from "lucide-react";

import {
  DEFAULT_CENTER,
  SIDEBAR_WIDTH,
  Z_INDEX,
} from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";
import { cn } from "@acme/ui";
import { Checkbox } from "@acme/ui/checkbox";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { Spinner } from "@acme/ui/spinner";

import { orpc, useQuery } from "~/orpc/react";
import { useOnKeyPress } from "~/utils/hooks/use-on-key-press";
import { useKeyPress } from "~/utils/key-press/hook";
import { onClickPlaceRowMap } from "~/utils/on-click-place-row-map";
import { placesAutocomplete } from "~/utils/place-autocomplete";
import { mapStore } from "~/utils/store/map";
import { searchStore } from "~/utils/store/search";
import {
  isF3LocationMapSearchResult,
  isF3RegionMapSearchResult,
  isGeoMapSearchResult,
} from "~/utils/types";
import { F3Logo } from "./f3-logo";
import {
  onClickPlaceRowF3Location,
  PlaceRowF3Location,
} from "./place-row-f3-location";
import { onClickF3RegionRow, PlaceRowF3Region } from "./place-row-f3-region";
import { PlaceRowMap } from "./place-row-map";
import { useTextSearchResults } from "./search-results-provider";

export function MapSearchBox({
  className,
  // Need to remove this prop from the component props
  hideLogo: _hideLogo,
  ...rest
}: ComponentProps<"div"> & { hideLogo?: true }) {
  const [showResults, setShowResults] = useState({
    geo: true,
    region: true,
    location: true,
  });
  const text = searchStore.use.text();
  const [isFocused, setIsFocused] = useState(false);
  const { data: workoutCount } = useQuery(
    orpc.map.location.workoutCount.queryOptions({ input: undefined }),
  );
  const { combinedResults } = useTextSearchResults();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const shouldRedirectOnResult = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const { pressedKeys } = useKeyPress();
  const checkboxContainerRef = useRef<HTMLInputElement>(null);

  const { ref: inputRef } = useOnKeyPress<HTMLInputElement>({
    keys: ["Enter"],
    cb: (key) => {
      if (key === "Enter") {
        onSubmit();
      }
    },
  });

  const onSubmit = useCallback(() => {
    const selectedResult = combinedResults[focusedIndex];
    if (selectedResult) {
      if (isF3LocationMapSearchResult(selectedResult)) {
        onClickPlaceRowF3Location(selectedResult);
      } else if (isGeoMapSearchResult(selectedResult)) {
        onClickPlaceRowMap(selectedResult);
      } else if (isF3RegionMapSearchResult(selectedResult)) {
        onClickF3RegionRow(selectedResult);
      }
      if (inputRef.current) {
        searchStore.setState({ text: selectedResult.header });
        inputRef.current.blur();
      }
    }
  }, [combinedResults, focusedIndex, inputRef]);

  useEffect(() => {
    if (pressedKeys.has("Escape")) {
      setIsFocused(false);
    }
  }, [pressedKeys]);

  return (
    <div
      className={cn(
        "-ml-1 flex flex-row items-center gap-2 px-4 transition-all",
        className,
      )}
      {...rest}
    >
      <F3Logo className={cn("transition-all", { hidden: isFocused })} />
      <div className="relative w-full">
        <Popover open={isFocused}>
          <PopoverTrigger className="w-full">
            <Input
              data-testid={TestId.MAP_SEARCHBOX_INPUT}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  setFocusedIndex((prev) =>
                    Math.min(prev + 1, combinedResults.length - 1),
                  );
                  e.preventDefault();
                } else if (e.key === "ArrowUp") {
                  setFocusedIndex((prev) => Math.max(prev - 1, 0));
                  e.preventDefault();
                }
              }}
              ref={(node) => {
                if (node) {
                  inputRef.current = node;
                }
              }}
              aria-expanded={isFocused}
              type="text"
              // placeholder="Search by location, zip, etc."
              placeholder={`Search ${workoutCount?.count === undefined ? "5000+" : workoutCount.count} free, peer-led workouts`}
              onFocus={() => {
                setIsFocused(true);
                setFocusedIndex(0);
              }}
              onBlur={(e) => {
                const clickedElement = e.relatedTarget as HTMLElement;
                if (checkboxContainerRef.current?.contains(clickedElement)) {
                  return;
                }
                setIsFocused(false);
              }}
              value={text}
              className={cn(
                "h-[42px] w-full rounded-full bg-foreground pl-10 text-base text-background caret-background placeholder:text-sm placeholder:text-background/60",
                "transition-all",
              )}
              onChange={(e) => {
                shouldRedirectOnResult.current = true;
                searchStore.setState({ text: e.target.value });

                if (!e.target.value) {
                  searchStore.setState({ placesResults: [] });
                } else if (e.target.value.length > 2) {
                  setIsLoading(true);
                  void placesAutocomplete({
                    input: e.target.value,
                    center: mapStore.get("center") ?? {
                      lat: DEFAULT_CENTER[0] ?? 37.7937,
                      lng: DEFAULT_CENTER[1] ?? -122.3965,
                    },
                    zoom: mapStore.get("zoom"),
                  }).then((results) => {
                    setIsLoading(false);
                    searchStore.setState({ placesResults: results });
                  });
                }
              }}
              onSubmit={() => onSubmit()}
            />
            <div className="pointer-events-none absolute left-3 top-2">
              <Search color="#aaa" />
            </div>
            <div className="absolute right-2 top-2 flex flex-row items-center gap-2">
              {isLoading && <Spinner className="h-4 w-4 border-2" />}
              {text && (
                <button
                  onClick={() => {
                    searchStore.setState({ text: "" });
                  }}
                >
                  <XCircle color="#aaa" />
                </button>
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            data-testid={TestId.MAP_SEARCHBOX_POPOVER_CONTENT_DESKTOP}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className={cn("h-[400px] overflow-scroll p-0")}
            style={{
              zIndex: Z_INDEX.MAP_SEARCHBOX_POPOVER_CONTENT_DESKTOP,
              width: SIDEBAR_WIDTH,
            }}
          >
            <>
              <div
                ref={checkboxContainerRef}
                className="border-b border-gray-200 p-2"
              >
                <div className="flex flex-row justify-center gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="show-locations"
                      checked={showResults.location}
                      onCheckedChange={(checked) => {
                        inputRef.current?.focus(); // focus so blur will call next time
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
                        inputRef.current?.focus(); // focus so blur will call next time
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
                        inputRef.current?.focus(); // focus so blur will call next time
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

              {combinedResults.length === 0 ? (
                <div className="mt-4 w-full text-center text-sm text-gray-700">
                  Search for a place or F3 workout by location, city, zip, etc.
                </div>
              ) : (
                combinedResults
                  .filter((result) => {
                    if (isF3LocationMapSearchResult(result)) {
                      return showResults.location;
                    }
                    if (isF3RegionMapSearchResult(result)) {
                      return showResults.region;
                    }
                    if (isGeoMapSearchResult(result)) {
                      return showResults.geo;
                    }
                    return true;
                  })
                  .slice(0, 30)
                  .map((result, index) =>
                    isF3LocationMapSearchResult(result) ? (
                      <PlaceRowF3Location
                        key={`f3-location-result-${result.destination.item.locationId}-${result.destination.item.eventId}`}
                        result={result}
                        focused={focusedIndex === index}
                      />
                    ) : isF3RegionMapSearchResult(result) ? (
                      <PlaceRowF3Region
                        key={`f3-region-result-${result.destination.id}`}
                        result={result}
                        focused={focusedIndex === index}
                      />
                    ) : (
                      <PlaceRowMap
                        key={`geo-result-${result.destination.placeId}`}
                        result={result}
                        focused={focusedIndex === index}
                      />
                    ),
                  )
              )}
            </>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
