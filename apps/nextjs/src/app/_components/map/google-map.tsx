"use client";

import { memo, useEffect, useState } from "react";
import { useWindowSize } from "@react-hook/window-size";
import { APIProvider, ControlPosition, Map } from "@vis.gl/react-google-maps";

import { BreakPoints, SIDEBAR_WIDTH } from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";
import { useTheme } from "@acme/ui/theme";

import { env } from "~/env";
import { useIsMobileWidth } from "~/utils/hooks/use-is-mobile-width";
import { useUpdateLocSearchParams } from "~/utils/hooks/use-update-loc-search-params";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import { closePanel, setSelectedItem } from "~/utils/store/selected-item";
import { MapEventListener } from "../map-event-listener";
import { MapLayoutItems } from "../map-layout-items";
import { ClusteredMarkers } from "../marker-clusters/clustered-markers";
import { useInitialLocation } from "./initial-location-provider";
import { PlaceResultIconPane } from "./place-result-icon-pane";
import { UpdatePane } from "./update-pane";

interface MapConfig {
  id: string;
  label: string;
  mapId?: string;
  mapTypeId?: string;
  styles?: google.maps.MapTypeStyle[];
}

const MapTypeId = {
  HYBRID: "hybrid",
  ROADMAP: "roadmap",
  SATELLITE: "satellite",
  TERRAIN: "terrain",
};

const MAP_CONFIGS: MapConfig[] = [
  {
    id: "light",
    label: "Light",
    mapId: "c125c852122e9fed",
    mapTypeId: MapTypeId.ROADMAP,
  },
  {
    id: "dark",
    label: "Dark",
    mapId: "d8b7f3c31882c7b2",
    mapTypeId: MapTypeId.ROADMAP,
  },
  {
    id: "hybrid",
    label: "Hybrid (no mapId)",
    mapId: "92006e222591cd7f",
    mapTypeId: MapTypeId.HYBRID,
  },
];

export const GoogleMapComponent = () => {
  const { initialCenter, initialZoom } = useInitialLocation();
  return (
    <APIProvider apiKey={env.NEXT_PUBLIC_GOOGLE_API_KEY}>
      <ProvidedGoogleMapComponent
        defaultZoom={initialZoom}
        defaultCenter={initialCenter}
      />
    </APIProvider>
  );
};

const ProvidedGoogleMapComponent = memo(
  ({
    defaultZoom,
    defaultCenter,
  }: {
    defaultZoom: number;
    defaultCenter: google.maps.LatLngLiteral;
  }) => {
    console.log("ProvidedGoogleMapComponent rerender");

    const { isMobileWidth } = useIsMobileWidth();
    const { resolvedTheme } = useTheme();

    const fractionalZoom = mapStore.use.fractionalZoom();
    const tiles = mapStore.use.tiles();
    const mapTiles = MAP_CONFIGS.find((map) =>
      tiles !== "street"
        ? map.id === tiles
        : resolvedTheme === "dark"
          ? map.id === "dark"
          : map.id === "light",
    );

    const [width, height] = useWindowSize();

    // We have to manage mounting the map otherwise there is a mismatch in rendered size
    // Causing it to render as a blank screen. Not sure why "use client" isn't working
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
      setIsMounted(true);
    }, []);
    if (!isMounted) {
      return <div style={{ height: "100vh", width: "100%" }} />;
    }

    return (
      <div
        style={{
          height: height,
          width:
            width >= Number(BreakPoints.LG) ? width - SIDEBAR_WIDTH : width,
        }}
      >
        <Map
          data-testid={TestId.MAP}
          backgroundColor={resolvedTheme === "dark" ? "#111" : "#fff"}
          mapId={mapTiles?.mapId}
          mapTypeId={mapTiles?.mapTypeId}
          styles={mapTiles?.styles}
          defaultZoom={defaultZoom}
          defaultCenter={defaultCenter}
          gestureHandling="greedy"
          streetViewControl={false}
          mapTypeControl={false}
          fullscreenControl={false}
          zoomControl={true}
          zoomControlOptions={{
            position: isMobileWidth
              ? ControlPosition.RIGHT_TOP
              : ControlPosition.RIGHT_BOTTOM,
          }}
          cameraControl={false}
          disableDoubleClickZoom
          isFractionalZoomEnabled={fractionalZoom}
          // styles={[ { featureType: "all", elementType: "all", stylers: [{ visibility: "off" }], }, ]}
          onClick={(e) => {
            console.log("map on click", e);
            if (appStore.get("mode") === "edit" && e.detail.latLng) {
              const latLng = e.detail.latLng;
              mapStore.setState({ updateLocation: latLng });
            } else {
              setSelectedItem({
                locationId: null,
                eventId: null,
                showPanel: false,
              });
              closePanel();
            }
          }}
          clickableIcons={false}
        >
          <UrlUpdater />
          <ClusteredMarkers />
          <MapLayoutItems />
          <UpdatePane />
          <PlaceResultIconPane />
          <MapEventListener />
        </Map>
      </div>
    );
  },
  () => {
    return false;
  },
);

ProvidedGoogleMapComponent.displayName = "ProvidedGoogleMapComponent";

const UrlUpdater = () => {
  useUpdateLocSearchParams();
  return null;
};
