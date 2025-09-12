import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";

import { mapStore } from "~/utils/store/map";

const MAP_LOG = false as boolean;
export const MapEventListener = () => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    // https://developers.google.com/maps/documentation/javascript/events
    const zoomChangedListener = map.addListener("zoom_changed", () => {
      // We can't set hasMovedMap here because zoom happens initially
      mapStore.setState({ event: "zoom" });
      MAP_LOG && console.log("zoom_changed", map.getZoom());
    });

    const dragEndListener = map.addListener("dragend", () => {
      mapStore.setState({ event: "idle", hasMovedMap: true });
      MAP_LOG && console.log("dragend");
    });

    const dragListener = map.addListener("dragstart", () => {
      mapStore.setState({ event: "drag", hasMovedMap: true });
      MAP_LOG && console.log("dragstart");
    });

    const centerChangedListener = map.addListener("center_changed", () => {
      mapStore.setState({ event: "drag", hasMovedMap: true });
      MAP_LOG && console.log("center_changed");
    });

    const idleListener = map.addListener("idle", () => {
      const center = map.getCenter();
      mapStore.setState({
        event: "idle",
        ...(center && { center: { lat: center.lat(), lng: center.lng() } }),
        zoom: map.getZoom(),
      });
    });

    return () => {
      zoomChangedListener.remove();
      idleListener.remove();
      dragEndListener.remove();
      dragListener.remove();
      centerChangedListener.remove();
    };
  }, [map]);

  return null;
};
