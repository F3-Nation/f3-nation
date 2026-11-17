import {
  AdvancedMarker,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";

import { cn } from "@acme/ui";

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
      className={cn(
        "marker cluster flex items-center justify-center rounded-full",
        "bg-primary/30",
      )}
      style={{ width: markerSize, height: markerSize }}
      anchorLeft="-50%"
      anchorTop="-50%"
    >
      <div
        className={cn(
          "relative flex h-4/5 w-4/5 items-center justify-center rounded-full",
          "bg-primary/50",
        )}
      >
        <div
          className={cn(
            "absolute flex h-3/4 w-3/4 items-center justify-center rounded-full",
            "bg-primary font-bold text-primary-foreground",
          )}
          style={{ fontSize: Math.max(markerSize / 4, 12) }}
        >
          {sizeAsText}
        </div>
      </div>
    </AdvancedMarker>
  );
};
