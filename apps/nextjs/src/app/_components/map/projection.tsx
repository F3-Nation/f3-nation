"use client";

// import { ClusteredMarkers } from "./clustered-markers";
import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";

import { mapStore } from "~/utils/store/map";

export const Projection = () => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const overlay = new google.maps.OverlayView();
    // not sure if these two have to be provided, maybe works fine without them..
    overlay.draw = () => {
      // I'm assuming this will always return the same projection instance, might not be the case...
      const proj = overlay.getProjection();
      if (proj !== mapStore.get("projection")) {
        mapStore.setState({ projection: proj });
      }
    };

    overlay.setMap(map);

    return () => {
      try {
        overlay.setMap(null);
        mapStore.setState({ projection: null });
      } catch (e) {
        console.error("error setting map to null", e);
      }
    };
  }, [map]);

  return null;
};
