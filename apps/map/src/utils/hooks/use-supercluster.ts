import type { FeatureCollection, GeoJsonProperties, Point } from "geojson";
import type { ClusterProperties, Options } from "supercluster";
import { useCallback, useMemo } from "react";
import Supercluster from "supercluster";

import { useMapViewport } from "./use-map-viewport";

export function useSupercluster<T extends GeoJsonProperties>(
  geojson: FeatureCollection<Point, T>,
  superclusterOptions: Options<T, ClusterProperties>,
) {
  // load in the same memo that creates the clusterer: querying an unloaded
  // instance throws, and a separate load effect runs only after render
  const clusterer = useMemo(
    () => new Supercluster(superclusterOptions).load(geojson.features),
    [superclusterOptions, geojson],
  );

  // get bounding-box and zoomlevel from the map
  const { bbox, zoom } = useMapViewport({ padding: 100 });

  // retrieve the clusters within the current viewport
  const clusters = useMemo(() => {
    if (!bbox || zoom == null) return [];

    return clusterer.getClusters(bbox, zoom);
  }, [clusterer, bbox, zoom]);

  // create callbacks to expose supercluster functionality outside of this hook
  const getChildren = useCallback(
    (clusterId: number) => clusterer.getChildren(clusterId),
    [clusterer],
  );

  // note: here, the paging that would be possible is disabled; we found this
  // has no significant performance impact when it's just used in a click event handler.
  const getLeaves = useCallback(
    (clusterId: number) => clusterer.getLeaves(clusterId, Infinity),
    [clusterer],
  );

  const getClusterExpansionZoom = useCallback(
    (clusterId: number) => clusterer.getClusterExpansionZoom(clusterId),
    [clusterer],
  );

  return {
    clusters,
    getChildren,
    getLeaves,
    getClusterExpansionZoom,
  };
}
