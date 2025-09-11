"use client";

import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";

import { mapStore } from "~/utils/store/map";

export const MapProvider = () => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    mapStore.setState({ map });
  }, [map]);

  return null;
};
