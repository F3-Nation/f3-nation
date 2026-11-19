"use client";

import { useCallback, useMemo } from "react";

import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";
import { ImageWithFallback } from "@acme/ui/image-with-fallback";

import type { LocationMarkerWithDistance } from "./filtered-map-results-provider";
import { summarizeAoSchedule } from "~/utils/ao-schedule-summary";
import { setView } from "~/utils/set-view";
import { appStore } from "~/utils/store/app";
import { searchStore } from "~/utils/store/search";
import {
  selectedItemStore,
  setSelectedItem,
} from "~/utils/store/selected-item";
import { rowStatusTag } from "~/utils/status-tag";
import { DayStrip } from "./day-strip";
import { StatusTagBadge } from "./status-tag-badge";

/**
 * One nearby-list row: an AO at one location, with its weekly days on an
 * S M T W T F S strip, the usual start time, one line for anything that
 * differs, and a tag for the most urgent upcoming change.
 */
export const NearbyLocationItem = (props: {
  item: LocationMarkerWithDistance;
}) => {
  RERENDER_LOGS && console.log("NearbyLocationItem rerender");
  const searchBarRef = searchStore.use.searchBarRef();

  const locationId = selectedItemStore.use.locationId();
  const ignoreNextNearbyItemMouseEnter =
    appStore.use.ignoreNextNearbyItemMouseEnter();
  const { item } = props;
  const isLocationSelected = item.id === locationId;

  const summary = useMemo(
    () => summarizeAoSchedule(item.events),
    [item.events],
  );
  const tag = useMemo(() => rowStatusTag(item.events), [item.events]);
  const types = useMemo(
    () => [
      ...new Set(
        item.events.flatMap((event) => event.eventTypes.map((t) => t.name)),
      ),
    ],
    [item.events],
  );

  const firstEventId = item.events[0]?.id ?? null;

  const handleClick = useCallback(() => {
    setSelectedItem({
      locationId: item.id,
      eventId: firstEventId,
      showPanel: true,
    });
    if (item.lat !== null && item.lon !== null) {
      setView({ lat: item.lat, lng: item.lon });
      // prevent the next mouse enter from triggering a change
      appStore.setState({ ignoreNextNearbyItemMouseEnter: true });
    }
    searchStore.setState({ shouldShowResults: false });
    searchBarRef.current?.blur();
  }, [item, firstEventId, searchBarRef]);

  return (
    <button
      className={cn(
        "relative flex w-full cursor-pointer flex-row gap-3 px-4 py-3 text-left text-foreground transition-colors hover:bg-muted/60",
        { "bg-muted": isLocationSelected },
      )}
      // @RollOver (SoCo - St. Louis) & @Mr. Roboto (New Bern, NC) had issues with the mouse events we were using here
      // Likely everything needs to be condensed to onClick and onMouseEnter for handleClick and handleHover
      // Dell Precision Notebook
      onClick={(e) => {
        handleClick();
        e.stopPropagation();
      }}
      onMouseEnter={(e) => {
        if (ignoreNextNearbyItemMouseEnter) {
          appStore.setState({ ignoreNextNearbyItemMouseEnter: false });
          return;
        }
        setSelectedItem({
          locationId: item.id,
          eventId: firstEventId,
          showPanel: false,
        });
        e.stopPropagation();
      }}
    >
      <ImageWithFallback
        // An empty logo is missing; the API already falls back to the region's.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        src={item.logo || "/f3_logo.png"}
        fallbackSrc="/f3_logo.png"
        loading="lazy"
        width={40}
        height={40}
        alt={`Logo for ${item.aoName ?? "F3"}`}
        // Many logos are white PNGs, so they sit on black in both themes.
        className="size-10 shrink-0 rounded-md border border-border bg-black object-contain"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 flex-row items-baseline gap-1.5">
          <span className="truncate text-sm leading-5 font-extrabold uppercase">
            {item.aoName}
          </span>
          {types.length ? (
            <span className="truncate text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
              {types.join(" · ")}
            </span>
          ) : null}
        </div>
        {item.fullAddress ? (
          <span className="truncate text-xs text-muted-foreground">
            {item.fullAddress}
          </span>
        ) : null}
        <div className="mt-1.5 flex flex-row items-center gap-2">
          <DayStrip days={summary.days} />
          <span
            className={cn("text-xs font-extrabold whitespace-nowrap", {
              "text-muted-foreground line-through": summary.allClosed,
            })}
          >
            {summary.timesVary ? "Times vary" : summary.time}
          </span>
        </div>
        {summary.detail ? (
          <span className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {summary.detail}
          </span>
        ) : null}
        {tag ? <StatusTagBadge tag={tag} className="mt-1.5" /> : null}
      </div>
    </button>
  );
};
