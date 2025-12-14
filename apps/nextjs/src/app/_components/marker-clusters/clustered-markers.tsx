import type Supercluster from "supercluster";
import { useCallback, useMemo } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { CLOSE_ZOOM } from "node_modules/@acme/shared/src/app/constants";

import type {
  F3ClusterProperties,
  MarkerProperties,
  MarkersProps,
} from "./types";
import { getGeojson } from "~/utils/get-geojson";
import { getMapPosForLeaves } from "~/utils/get-map-pos-for-leaves";
import { useSupercluster } from "~/utils/hooks/use-supercluster";
import { mapStore } from "~/utils/store/map";
import { useFilteredMapResults } from "../map/filtered-map-results-provider";
import { FeatureMarker } from "../map/group-marker";
import { FeaturesClusterMarker } from "./features-cluster-marker";

const superclusterOptions: Supercluster.Options<
  MarkerProperties,
  F3ClusterProperties
> = {
  extent: 256, // smaller means more in a cluster
  radius: 64, // Adjust this. smaller means more smaller clusters
  maxZoom: 12,
};

export const ClusteredMarkers = () => {
  const { filteredLocationMarkers } = useFilteredMapResults();

  const geojson = useMemo(() => {
    if (!filteredLocationMarkers) return null;
    return getGeojson(filteredLocationMarkers);
  }, [filteredLocationMarkers]);
  return geojson && <DataProvidedClusteredMarkers geojson={geojson} />;
};

const DataProvidedClusteredMarkers = ({ geojson }: MarkersProps) => {
  const modifiedLocationMarkers = mapStore.use.modifiedLocationMarkers();
  // const [width] = useWindowSize();

  const map = useMap();
  const zoom = mapStore.use.zoom();
  const isClose = useMemo(() => {
    return zoom >= CLOSE_ZOOM;
  }, [zoom]);
  const { clusters, getLeaves } = useSupercluster(geojson, superclusterOptions);
  const handleClusterClick = useCallback(
    (marker: google.maps.marker.AdvancedMarkerElement, clusterId: number) => {
      const leaves = getLeaves(clusterId);

      if (!map) {
        console.log("handleClusterClick - no map instance");
        return;
      }

      const { center, zoom } = getMapPosForLeaves({
        leaves,
        map,
        lngScale: 1.05, // small border
        latScale: 1.2, // room for search bar and top components
      });

      // Use timeouts to allow fractional zoom to be applied and undone
      mapStore.setState({ fractionalZoom: true });
      setTimeout(() => {
        map.setZoom(zoom);
        map.panTo(center);
        setTimeout(() => {
          mapStore.setState({ fractionalZoom: false });
        }, 50);
      }, 50);
    },
    [getLeaves, map],
  );

  return (
    <>
      {clusters.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        if (typeof lng !== "number" || typeof lat !== "number") return null;
        const featureId = feature.id?.toString();
        if (!featureId) return null;

        const clusterProperties = feature.properties as F3ClusterProperties;
        const isCluster: boolean = clusterProperties.cluster;

        return isCluster ? (
          <FeaturesClusterMarker
            key={featureId}
            clusterId={clusterProperties.cluster_id}
            position={{ lat, lng }}
            size={clusterProperties.point_count}
            sizeAsText={String(clusterProperties.point_count_abbreviated)}
            onMarkerClick={handleClusterClick}
          />
        ) : (
          <FeatureMarker
            key={featureId}
            featureId={featureId}
            position={{ lat, lng }}
            isClose={isClose}
          />
        );
      })}
      {Object.entries(modifiedLocationMarkers).map(([id, marker]) => {
        return (
          <FeatureMarker
            key={id}
            featureId={id}
            position={marker}
            isClose={isClose}
          />
        );
      })}
    </>
  );
};
