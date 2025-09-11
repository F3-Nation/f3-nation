import type { Feature, Point } from "geojson";

import { bound } from "@acme/shared/common/functions";

import { adjustBounds } from "~/utils/adjust-bounds";
import { getBoundsOfLeaves } from "~/utils/get-bounds-of-leaves";

const DEFAULT_ZOOM = 5;

export const getMapPosForLeaves = (params: {
  leaves: Feature<Point>[];
  map: google.maps.Map;
  lngScale?: number;
  latScale?: number;
}) => {
  const { leaves, map, lngScale = 1, latScale = 1 } = params;

  const boundsOfLeaves = getBoundsOfLeaves(leaves);
  const adjustedBounds = adjustBounds({
    bounds: boundsOfLeaves,
    lngScale,
    latScale,
  });

  const currentBounds = map.getBounds() ?? new google.maps.LatLngBounds();
  const currentZoom = map.getZoom() ?? DEFAULT_ZOOM;

  const ne = adjustedBounds.getNorthEast();
  const sw = adjustedBounds.getSouthWest();
  const center = {
    lat: (ne.lat() + sw.lat()) / 2,
    lng: (ne.lng() + sw.lng()) / 2,
  };

  // Calculate spans
  const latSpan = ne.lat() - sw.lat();
  const lngSpan = ne.lng() - sw.lng();

  const currentNe = currentBounds.getNorthEast();
  const currentSw = currentBounds.getSouthWest();
  const currentLatSpan = Math.abs(currentNe.lat() - currentSw.lat());
  const currentLngSpan = Math.abs(currentNe.lng() - currentSw.lng());

  // Calculate zoom offset based on span ratios
  const latZoomOffset = Math.log2(latSpan / currentLatSpan);
  const lngZoomOffset = Math.log2(lngSpan / currentLngSpan);

  // Calculate new zoom levels
  const latZoom = currentZoom - latZoomOffset;
  const lngZoom = currentZoom - lngZoomOffset;

  // Use the smaller zoom to ensure all points are visible
  const zoomValue = bound(Math.min(latZoom, lngZoom), 3, 20);

  // It seems that fractional zoom is applied automatically
  // const zoom = IS_FRACTIONAL_ZOOM_ENABLED ? zoomValue : Math.floor(zoomValue);
  const zoom = Number.isNaN(zoomValue) ? DEFAULT_ZOOM : zoomValue;

  return { center, zoom };
};
