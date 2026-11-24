import type {
  AoGroupedLocationMarker,
  LocationMarkerWithDistance,
} from "~/app/_components/map/filtered-map-results-provider";

/**
 * Pick an AO row's logo: the AO's own logo, else the location's logo when the
 * location belongs to that same AO. Empty logos count as missing, and another
 * AO's logo is never a valid fallback.
 */
const resolveAoLogo = (
  marker: LocationMarkerWithDistance,
  aoName: LocationMarkerWithDistance["aoName"],
  aoLogo: string | null | undefined,
): LocationMarkerWithDistance["logo"] => {
  const fallbackLogo = aoName === marker.aoName ? marker.logo : null;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return aoLogo || fallbackLogo;
};

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
      // Treat an empty AO name as missing so the row keeps the pin's AO label instead of going blank.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const aoName = event?.aoName || marker.aoName;
      return [
        {
          ...marker,
          aoId: `${marker.id}`,
          aoName,
          logo: resolveAoLogo(marker, aoName, event?.aoLogo),
        },
      ];
    }

    return Array.from(eventsByAo.entries()).map(([aoName, events]) => ({
      ...marker,
      aoId: `${marker.id}-${events[0]?.id}`,
      aoName,
      logo: resolveAoLogo(marker, aoName, events[0]?.aoLogo),
      events,
    }));
  });
};
