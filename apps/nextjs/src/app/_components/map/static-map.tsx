import {
  createStaticMapsUrl,
  StaticMap,
} from "@vis.gl/react-google-maps/server";

import { isTruthy } from "@acme/shared/common/functions";

import { env } from "~/env";
import { ssg } from "~/trpc/ssg";

export default async function StaticMapPreview() {
  const mapEventAndLocationData =
    await ssg.location.getMapEventAndLocationData.fetch();

  const markers = mapEventAndLocationData
    .slice(0, 10)
    .map((marker) => {
      const lat = marker[3];
      const lon = marker[4];
      return lat == null || lon == null ? null : { lat, lon };
    })
    .filter(isTruthy);

  const staticMapsUrl = createStaticMapsUrl({
    apiKey: env.NEXT_PUBLIC_GOOGLE_API_KEY,
    format: "png",
    scale: 4,
    width: 1200,
    height: 800,
    center: { lat: 32, lng: -97 },
    zoom: 4,
    language: "en",
    markers: markers
      .slice(0, 10)
      .map((marker) =>
        typeof marker.lat === "number" && typeof marker.lon === "number"
          ? {
              location: { lat: marker.lat, lng: marker.lon },
              icon: "http://tinyurl.com/jrhlvu6",
              anchor: "center",
              scale: 2 as 1 | 2 | 4 | undefined,
            }
          : null,
      )
      .filter(isTruthy),
  });

  return (
    <div className="h-full w-full">
      <StaticMap url={staticMapsUrl} className="h-full w-full object-cover" />
    </div>
  );
}
