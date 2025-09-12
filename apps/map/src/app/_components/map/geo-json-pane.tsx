"use client";

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";

import { COUNTRY_ZOOM } from "@acme/shared/app/constants";

import { VISIBLE_COUNTRIES } from "~/assets/visible-countries";
import { mapStore } from "~/utils/store/map";

export const GeoJsonPane = () => {
  const map = useMap();
  const zoom = mapStore.use.zoom();
  const features = useRef<google.maps.Data.Feature[]>([]);

  useEffect(() => {
    if (!map) return;
    if (zoom < COUNTRY_ZOOM) {
      if (!features.current.length) {
        const newFeatures = map.data.addGeoJson(VISIBLE_COUNTRIES, {
          idPropertyName: "countries",
        });
        // https://developers.google.com/maps/documentation/javascript/examples/layer-data-dynamic
        map.data.setStyle({
          fillColor: "#dc2626",
          strokeColor: "#dc2626",
          strokeWeight: 1,
        });
        features.current = newFeatures;
      }
    } else {
      features.current.forEach((feature) => {
        map.data.remove(feature);
      });
      features.current = [];
    }
    return () => {
      features.current.forEach((feature) => {
        map.data.remove(feature);
      });
      features.current = [];
    };
  }, [map, zoom]);
  return null;
};
