import type { BBox } from "geojson";
import { useEffect, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";

interface MapViewportOptions {
  padding?: number;
}

export function useMapViewport({ padding = 0 }: MapViewportOptions = {}) {
  const map = useMap();
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    if (!map) return;

    const updateViewport = () => {
      const bounds = map.getBounds();
      const currentZoom = map.getZoom();
      const projection = map.getProjection();

      if (!bounds || currentZoom == null || !projection) return;

      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();

      const paddingDegrees = degreesPerPixel(currentZoom) * padding;

      const n = Math.min(90, ne.lat() + paddingDegrees);
      const s = Math.max(-90, sw.lat() - paddingDegrees);

      const w = sw.lng() - paddingDegrees;
      const e = ne.lng() + paddingDegrees;

      setBbox([w, s, e, n]);
      setZoom(currentZoom);
    };

    // Read initial viewport immediately if the map is already ready
    updateViewport();

    const listener = map.addListener("idle", updateViewport);
    return () => listener.remove();
  }, [map, padding]);

  return { bbox, zoom };
}

function degreesPerPixel(zoomLevel: number) {
  // 360° divided by the number of pixels at the zoom-level
  return 360 / (Math.pow(2, zoomLevel) * 256);
}
