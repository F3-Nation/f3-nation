import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";

import { closePanel } from "~/utils/store/selected-item";

interface TreeClusterMarkerProps {
  clusterId: number;
  onMarkerClick?: (
    marker: google.maps.marker.AdvancedMarkerElement,
    clusterId: number,
  ) => void;
  position: google.maps.LatLngLiteral;
  size: number;
  sizeAsText: string;
}

export const FeaturesClusterMarker = ({
  position,
  size,
  sizeAsText,
  onMarkerClick,
  clusterId,
}: TreeClusterMarkerProps) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const markerSize = Math.floor(36 + Math.sqrt(size) * 2);

  return (
    <AdvancedMarker
      ref={markerRef}
      position={position}
      zIndex={size}
      onClick={(e) => {
        // Must call stop to prevent the map from being clicked
        e.stop();
        if (marker == null) {
          throw new Error("Marker is null");
        }
        closePanel();
        return onMarkerClick?.(marker, clusterId);
      }}
      className={
        "marker cluster flex items-center justify-center rounded-full bg-foreground/30"
      }
      style={{ width: markerSize, height: markerSize }}
      anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
    >
      <div className="relative flex h-4/5 w-4/5 items-center justify-center rounded-full bg-foreground/50">
        <div
          className="absolute flex h-3/4 w-3/4 items-center justify-center rounded-full bg-foreground text-background"
          style={{ fontSize: Math.max(markerSize / 4, 12) }}
        >
          {sizeAsText}
        </div>
      </div>
    </AdvancedMarker>
  );
};
