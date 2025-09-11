import { useEffect } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";

import { DEFAULT_CENTER } from "@acme/shared/app/constants";

import { env } from "~/env";

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
  return (
    <APIProvider apiKey={env.NEXT_PUBLIC_GOOGLE_API_KEY}>
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
  useEffect(() => {
    if (latitude != null && longitude != null) {
      map?.setCenter({
        lat: latitude,
        lng: longitude,
      });
    }
  }, [latitude, longitude, map]);
  return (
    <Map
      center={
        !onCenterChanged && latitude != null && longitude != null
          ? { lat: latitude, lng: longitude }
          : undefined
      }
      defaultZoom={14}
      defaultCenter={{
        lat: latitude ?? DEFAULT_CENTER[0],
        lng: longitude ?? DEFAULT_CENTER[1],
      }}
      onIdle={(e) => {
        const center = e.map.getCenter();
        const lat = center?.lat();
        const lng = center?.lng();
        if (onCenterChanged && lat != null && lng != null) {
          onCenterChanged({ lat, lng });
        }
      }}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl">
        📍
      </div>
    </Map>
  );
};
