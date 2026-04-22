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
      return [{ ...marker, aoId: `${marker.id}` }];
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
