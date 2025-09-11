import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const useUpdateEventSearchParams = (
  locationId: number | null,
  eventId: number | null,
) => {
  const router = useRouter();
  const lastLocationId = useRef<number | null>(null);
  const lastEventId = useRef<number | null>(null);
  const searchParams = useSearchParams();

  // Update the search params when the panel is open
  useEffect(() => {
    if (locationId == null) return;

    if (
      lastLocationId.current === locationId &&
      lastEventId.current === eventId
    ) {
      return;
    }

    lastLocationId.current = locationId;
    lastEventId.current = eventId;

    const params = new URLSearchParams(searchParams?.toString());

    // Set the map position parameters
    if (eventId != null) {
      params.set("eventId", eventId.toString());
    }
    params.set("locationId", locationId.toString());

    // Remove eventId and locationId parameters if they exist
    params.delete("lat");
    params.delete("lng");
    params.delete("zoom");

    // Use router.replace to update URL without full page reload
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [locationId, eventId, searchParams, router]);
};
