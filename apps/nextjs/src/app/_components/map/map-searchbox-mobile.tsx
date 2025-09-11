"use client";

import type { ComponentProps } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, XCircle } from "lucide-react";

import { DEFAULT_CENTER, Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Input } from "@acme/ui/input";

import { useOnKeyPress } from "~/utils/hooks/use-on-key-press";
import { onClickPlaceRowMap } from "~/utils/on-click-place-row-map";
import { placesAutocomplete } from "~/utils/place-autocomplete";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import { searchStore } from "~/utils/store/search";
import { setSelectedItem } from "~/utils/store/selected-item";
import { isGeoMapSearchResult } from "~/utils/types";
import { useTextSearchResults } from "./search-results-provider";

export function MapSearchBoxMobile({
  className,
  ...rest
}: ComponentProps<"div">) {
  const isMobile = appStore.use.isMobileDeviceWidth();
  const text = searchStore.use.text();
  const searchBarFocused = searchStore.use.searchBarFocused();
  const { combinedResults } = useTextSearchResults();
  const searchBarRef = searchStore.use.searchBarRef();

  const onSubmit = () => {
    const selectedResult = combinedResults[0];
    if (selectedResult && isGeoMapSearchResult(selectedResult)) {
      onClickPlaceRowMap(selectedResult);
    }
  };

  const eject = () => {
    inputRef.current?.blur();
    searchStore.setState({
      text: "",
      shouldShowResults: false,
      searchBarFocused: false,
    });
  };

  const { ref: inputRef } = useOnKeyPress<HTMLInputElement>({
    keys: ["Enter"],
    cb: (key) => {
      if (key === "Enter") {
        onSubmit();
      }
    },
  });

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-1 left-0 right-0 block lg:hidden",
        className,
      )}
      style={{ zIndex: Z_INDEX.MAP_SEARCHBOX_MOBILE }}
      {...rest}
    >
      <div
        className={cn(
          " grid grid-cols-[1fr] items-center px-2 transition-all",
          className,
        )}
        {...rest}
      >
        {/* Search box component for the map */}
        <div className="pointer-events-auto relative w-full">
          <div className="pointer-events-none absolute left-[6px] flex h-full flex-col justify-center">
            {/* <Search className="size-7 text-muted-foreground" /> */}
            {text || searchBarFocused ? (
              <button
                className="pointer-events-auto mx-auto"
                onFocus={eject}
                onMouseOver={eject}
                onClick={eject}
              >
                <ChevronLeft className="size-7 text-background" />
              </button>
            ) : (
              <Link
                href="https://f3nation.com/"
                target="_blank"
                className="pointer-events-auto mx-auto"
              >
                <Image
                  src="/f3_logo.png"
                  alt="F3 Logo"
                  width={32}
                  height={32}
                  className="rounded-md"
                />
              </Link>
            )}
          </div>
          <div className="flex flex-col items-center justify-center">
            <Input
              ref={(node) => {
                if (node) {
                  searchBarRef.current = node;
                  inputRef.current = node;
                }
              }}
              type="text"
              placeholder={
                isMobile
                  ? "See nearby / search"
                  : "Search by location, zip, etc."
              }
              onFocus={() => {
                inputRef.current?.select();
                searchStore.setState({
                  searchBarFocused: true,
                  shouldShowResults: true,
                });
                setSelectedItem({
                  locationId: null,
                  eventId: null,
                  showPanel: false,
                });
              }}
              onBlur={() => {
                searchStore.setState({
                  searchBarFocused: false,
                });
              }}
              value={text}
              className="h-[42px] rounded-full bg-foreground pl-11 text-base text-background caret-background placeholder:text-muted-foreground"
              // enterKeyHint="done"
              onChange={(e) => {
                searchStore.setState({
                  text: e.target.value,
                  shouldShowResults: true,
                });

                if (!e.target.value) {
                  searchStore.setState({ placesResults: [] });
                } else if (e.target.value.length > 2) {
                  const center = mapStore.get("center") ?? {
                    lat: DEFAULT_CENTER[0] ?? 37.7937,
                    lng: DEFAULT_CENTER[1] ?? -122.3965,
                  };
                  const zoom = mapStore.get("zoom");
                  void placesAutocomplete({
                    input: e.target.value,
                    center,
                    zoom,
                  }).then((results) => {
                    searchStore.setState({ placesResults: results });
                  });
                }
              }}
            />
            {/* <WithLove /> */}
          </div>
          <div className="pointer-events-none absolute bottom-0 right-2 top-0 flex flex-col items-center justify-center">
            {text || searchBarFocused ? (
              <button
                className="pointer-events-auto mx-auto"
                onFocus={eject}
                onMouseOver={eject}
                onClick={eject}
              >
                <XCircle className="size-7 text-muted-foreground" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
