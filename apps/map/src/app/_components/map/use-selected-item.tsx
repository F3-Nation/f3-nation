import { useEffect, useMemo, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import debounce from "lodash/debounce";

import { CLOSE_ZOOM } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";

import { orpc, useQuery } from "~/orpc/react";
import { DAYS_OF_WEEK } from "~/utils/days-of-week";
import { mapStore } from "~/utils/store/map";
import { selectedItemStore } from "~/utils/store/selected-item";

export const useSelectedItem = () => {
  RERENDER_LOGS && console.log("useSelectedItem rerender");
  const map = useMap();
  const bounds = map?.getBounds();
  const zoom = mapStore.use.zoom();
  const isClose = zoom >= CLOSE_ZOOM;
  const debounceAmount = isClose ? 0 : 300;
  const locationId = selectedItemStore.use.locationId();
  const eventId = selectedItemStore.use.eventId();
  const modifiedLocationMarkers = mapStore.use.modifiedLocationMarkers();
  const [debouncedLocationId, setDebouncedLocationId] = useState(locationId);
  const { data } = useQuery(
    orpc.map.location.locationWorkout.queryOptions({
      input: { locationId: debouncedLocationId ?? -1 },
      enabled: typeof debouncedLocationId === "number",
    }),
  );

  const { data: upcomingInstancesData } = useQuery(
    orpc.map.location.upcomingInstances.queryOptions({
      input: undefined,
    }),
  );

  const selectedLocation = useMemo(() => {
    if (debouncedLocationId !== locationId) return undefined;

    const selectedLocation = data?.location;
    if (!selectedLocation) return undefined;

    const modifiedLocationMarker = modifiedLocationMarkers[selectedLocation.id];
    if (!modifiedLocationMarker) return selectedLocation;

    selectedLocation.lat = modifiedLocationMarker.lat;
    selectedLocation.lon = modifiedLocationMarker.lng;

    return selectedLocation;
  }, [debouncedLocationId, locationId, data, modifiedLocationMarkers]);

  const position = useMemo(() => {
    const ne = bounds?.getNorthEast();
    const sw = bounds?.getSouthWest();
    if (
      typeof selectedLocation?.lat !== "number" ||
      typeof selectedLocation?.lon !== "number" ||
      !ne ||
      !sw ||
      // Outside of the bounds
      selectedLocation.lat > ne?.lat() ||
      selectedLocation.lon > ne?.lng() ||
      selectedLocation.lat < sw?.lat() ||
      selectedLocation.lon < sw?.lng()
    ) {
      return undefined;
    }
    const projection = mapStore.get("projection");

    const point = projection?.fromLatLngToContainerPixel({
      lat: selectedLocation.lat,
      lng: selectedLocation.lon,
    });
    return { x: point?.x, y: point?.y ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoom is not a dependency but we need to monitor its changes
  }, [selectedLocation?.lat, selectedLocation?.lon, map, zoom, bounds]);

  const selectedEvent = useMemo(() => {
    if (!selectedLocation) return undefined;
    if (eventId === null || eventId === undefined) {
      return selectedLocation.events[0];
    }

    const realEvent = selectedLocation.events.find(
      (event) => event.id == eventId,
    );
    if (realEvent) return realEvent;

    if (eventId < 0) {
      const instanceId = -eventId;
      const instance = upcomingInstancesData?.find((i) => i.id === instanceId);
      if (instance) {
        const dayOfWeek = instance.startDate
          ? DAYS_OF_WEEK[
              new Date(instance.startDate + "T00:00:00").getUTCDay()
            ] ?? null
          : null;
        return {
          id: eventId,
          name: instance.name,
          dayOfWeek,
          startTime: instance.startTime,
          endTime: instance.endTime,
          description: null,
          eventTypes: instance.eventTypes,
          aoId: null,
          aoName: instance.aoName,
          aoLogo: instance.aoLogo,
          aoWebsite: null,
        } as NonNullable<
          NonNullable<typeof data>["location"]
        >["events"][number];
      }
    }

    return undefined;
  }, [selectedLocation, eventId, upcomingInstancesData]);

  // Create memoized debounced function
  const debouncedSetSelectedItem = useMemo(
    () =>
      debounce((locationId: number | null) => {
        setDebouncedLocationId(locationId);
      }, debounceAmount),
    [debounceAmount],
  );

  useEffect(() => {
    debouncedSetSelectedItem(locationId);
  }, [debouncedLocationId, locationId, debouncedSetSelectedItem]);

  // useEffect(() => {
  //   if (!selectedLocation || eventId !== null) return;

  //   const firstEvent = selectedLocation.events[0];
  //   if (!firstEvent) return;

  //   setSelectedItem({ eventId: firstEvent.id });
  // }, [eventId, selectedLocation]);

  // TODO: Styles need to be cleaned up a little and I need to come back as a perfectionist to make sure everything looks beautiful
  return {
    locationId,
    eventId,
    selectedLocation,
    selectedEvent,
    pagePosition: position,
  };
};
