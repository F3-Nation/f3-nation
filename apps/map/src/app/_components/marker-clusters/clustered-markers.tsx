import type { Options } from "supercluster";
import { useCallback, useMemo } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { DAY_LABEL_ZOOM } from "@acme/shared/app/constants";

import type {
  F3ClusterProperties,
  MarkerProperties,
  MarkersProps,
} from "./types";
import { getClusterFeatureKey } from "~/utils/get-cluster-feature-key";
import { getGeojson } from "~/utils/get-geojson";
import { getMapPosForLeaves } from "~/utils/get-map-pos-for-leaves";
import { labeledPinIds } from "~/utils/label-collisions";
import { useSupercluster } from "~/utils/hooks/use-supercluster";
import { mapStore } from "~/utils/store/map";
import { selectedItemStore } from "~/utils/store/selected-item";
import { useFilteredMapResults } from "../map/filtered-map-results-provider";
import { FeatureMarker } from "../map/group-marker";
import { FeaturesClusterMarker } from "./features-cluster-marker";

const superclusterOptions: Options<MarkerProperties, F3ClusterProperties> = {
  extent: 256, // smaller means more in a cluster
  radius: 64, // Adjust this. smaller means more smaller clusters
  // Stop clustering a zoom before day labels appear, so every location shows
  // as its own plain pin first.
  maxZoom: DAY_LABEL_ZOOM - 1,
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
  const showDayLabels = useMemo(() => {
    return zoom >= DAY_LABEL_ZOOM;
  }, [zoom]);
  const { clusters, getLeaves } = useSupercluster(geojson, superclusterOptions);
  const { filteredLocationMarkers } = useFilteredMapResults();
  const selectedLocationId = selectedItemStore.use.locationId();
  const panelLocationId = selectedItemStore.use.panelLocationId();

  // Pins whose day label fits without covering another label. The rest stay
  // plain pins until the map is zoomed in far enough.
  const labeledPins = useMemo(() => {
    if (!showDayLabels) return new Set<number>();
    return labeledPinIds({
      clusters,
      modifiedLocationMarkers,
      locationMarkers: filteredLocationMarkers ?? [],
      pinnedIds: [selectedLocationId, panelLocationId],
      zoom,
    });
  }, [
    showDayLabels,
    clusters,
    modifiedLocationMarkers,
    filteredLocationMarkers,
    selectedLocationId,
    panelLocationId,
    zoom,
  ]);
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
        const key = getClusterFeatureKey(feature);
        if (!featureId || !key) return null;

        // Supercluster returns point features alongside clusters.
        const clusterProperties = feature.properties;

        return "cluster" in clusterProperties ? (
          <FeaturesClusterMarker
            key={key}
            clusterId={clusterProperties.cluster_id}
            position={{ lat, lng }}
            size={clusterProperties.point_count}
            sizeAsText={String(clusterProperties.point_count_abbreviated)}
            onMarkerClick={handleClusterClick}
          />
        ) : (
          <FeatureMarker
            key={key}
            featureId={featureId}
            position={{ lat, lng }}
            showDayLabels={labeledPins.has(Number(featureId))}
          />
        );
      })}
      {Object.entries(modifiedLocationMarkers).map(([id, marker]) => {
        return (
          <FeatureMarker
            key={id}
            featureId={id}
            position={marker}
            showDayLabels={labeledPins.has(Number(id))}
          />
        );
      })}
    </>
  );
};
