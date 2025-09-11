import { queryClientUtils } from "~/trpc/react";

export const getRandomLocation = () => {
  const markers =
    queryClientUtils.location.getMapEventAndLocationData.getData();
  const randomMarker = markers?.[Math.floor(Math.random() * markers.length)];
  if (!randomMarker) throw new Error("No markers found");
  return {
    lat: randomMarker[3],
    lon: randomMarker[4],
  };
};
