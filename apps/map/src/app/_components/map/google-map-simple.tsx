import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

import { DEFAULT_CENTER } from "@acme/shared/app/constants";

interface GoogleMapSimpleProps {
  latitude: number | undefined;
  longitude: number | undefined;
  onCenterChanged?: (position: google.maps.LatLngLiteral) => void;
}

export const GoogleMapSimple = ({
  latitude,
  longitude,
  onCenterChanged,
}: GoogleMapSimpleProps) => {
  const googleApiKey = window.__F3_RUNTIME__?.googleApiKey ?? "";

  return (
    <APIProvider apiKey={googleApiKey}>
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
}: GoogleMapSimpleProps) => {
  const map = useMap();

  // Keep map centered when form values change (e.g. address lookup)
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
