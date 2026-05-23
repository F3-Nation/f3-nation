"use client";

import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

import { DEFAULT_CENTER } from "@acme/shared/app/constants";

interface ProvidedGoogleMapSimpleProps {
  latitude: number | undefined;
  longitude: number | undefined;
  onCenterChanged?: (position: google.maps.LatLngLiteral) => void;
}

interface GoogleMapSimpleProps extends ProvidedGoogleMapSimpleProps {
  apiKey: string;
}

export const GoogleMapSimple = ({
  apiKey,
  latitude,
  longitude,
  onCenterChanged,
}: GoogleMapSimpleProps) => {
  return (
    <APIProvider apiKey={apiKey}>
      <ProvidedGoogleMapSimple
        latitude={latitude}
        longitude={longitude}
        onCenterChanged={onCenterChanged}
      />
    </APIProvider>
  );
};

const ProvidedGoogleMapSimple = ({
  latitude,
  longitude,
  onCenterChanged,
}: ProvidedGoogleMapSimpleProps) => {
  const map = useMap();

  useEffect(() => {
    if (latitude != null && longitude != null && map) {
      map.setCenter({ lat: latitude, lng: longitude });
    }
  }, [latitude, longitude, map]);

  return (
    <Map
      defaultZoom={14}
      defaultCenter={{
        lat: latitude ?? DEFAULT_CENTER[0],
        lng: longitude ?? DEFAULT_CENTER[1],
      }}
    >
      <Marker
        position={{
          lat: latitude ?? DEFAULT_CENTER[0],
          lng: longitude ?? DEFAULT_CENTER[1],
        }}
        draggable
        onDragEnd={(e) => {
          const latLng = e.latLng;
          if (!latLng || !onCenterChanged) return;

          onCenterChanged({
            lat: latLng.lat(),
            lng: latLng.lng(),
          });
        }}
      />
    </Map>
  );
};
