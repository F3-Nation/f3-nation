import type { F3LocationMapSearchResult, SparseF3Marker } from "~/utils/types";

export const buildF3LocationSearchResults = ({
  locationMarkers,
  text,
  eventIdToRegionNameLookup,
  locationIdToRegionNameLookup,
}: {
  locationMarkers: SparseF3Marker[] | undefined;
  text: string;
  eventIdToRegionNameLookup?: Record<string, string>;
  locationIdToRegionNameLookup?: Record<string, string>;
}): F3LocationMapSearchResult[] => {
  const lowerText = text.toLowerCase();

  const aoResults =
    locationMarkers?.flatMap((location) => {
      const matchingAoNames = new Set<string>();
      for (const event of location.events) {
        if (event.aoName?.toLowerCase().includes(lowerText)) {
          matchingAoNames.add(event.aoName);
        }
      }

      return Array.from(matchingAoNames).map((aoName) => {
        const aoEvent = location.events.find((e) => e.aoName === aoName);
        const searchResult: F3LocationMapSearchResult = {
          key: `ao-${location.id}-${aoName}`,
          type: "location",
          header: aoName,
          destination: {
            id: location.id,
            lat: location.lat ?? 0,
            lng: location.lon ?? 0,
            logo: aoEvent?.aoLogo ?? location.logo ?? "",
            item: { eventId: null, locationId: location.id },
            placeId: null,
            regionName: locationIdToRegionNameLookup?.[location.id] ?? null,
          },
        };
        return searchResult;
      });
    }) ?? [];

  const eventResults =
    locationMarkers?.flatMap((location) =>
      location.events
        .filter((event) => event.name.toLowerCase().includes(lowerText))
        .slice(0, 1)
        .map((event) => {
          const searchResult: F3LocationMapSearchResult = {
            key: `event-${event.id}`,
            type: "location",
            header: event.name,
            destination: {
              id: event.id,
              lat: location.lat ?? 0,
              lng: location.lon ?? 0,
              logo: event.aoLogo ?? location.logo ?? "",
              item: { eventId: event.id, locationId: location.id },
              placeId: null,
              regionName: eventIdToRegionNameLookup?.[event.id] ?? null,
            },
          };
          return searchResult;
        }),
    ) ?? [];

  return [...aoResults, ...eventResults];
};
