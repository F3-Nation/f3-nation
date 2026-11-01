import type {
  AoGroupedLocationMarker,
  LocationMarkerWithDistance,
} from "~/app/_components/map/filtered-map-results-provider";

/**
 * Split each location marker's events by AO so the nearby list shows one row
 * per AO even when multiple AOs share the same physical location.
 */
export const groupMarkersByAo = (
  markers: LocationMarkerWithDistance[],
): AoGroupedLocationMarker[] => {
  return markers.flatMap((marker) => {
    const eventsByAo = new Map<string, (typeof marker)["events"]>();

    for (const event of marker.events) {
      const key = event.aoName ?? "";
      const existing = eventsByAo.get(key);
      if (existing) {
        existing.push(event);
      } else {
        eventsByAo.set(key, [event]);
      }
    }

    if (eventsByAo.size <= 1) {
      const event = marker.events[0];
      // Missing synthetic-event names must not replace the location's label.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const aoName = event?.aoName || marker.aoName;
      const fallbackLogo = aoName === marker.aoName ? marker.logo : null;
      // Empty logos are missing; another AO's logo is not a valid fallback.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const logo = event?.aoLogo || fallbackLogo;
      return [
        {
          ...marker,
          aoId: `${marker.id}`,
          aoName,
          logo,
        },
      ];
    }

    return Array.from(eventsByAo.entries()).map(([aoName, events]) => ({
      ...marker,
      aoId: `${marker.id}-${events[0]?.id}`,
      aoName,
      logo: events[0]?.aoLogo ?? marker.logo,
      events,
    }));
  });
};
