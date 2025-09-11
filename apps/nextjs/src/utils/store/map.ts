import { DEFAULT_CENTER, DEFAULT_ZOOM } from "@acme/shared/app/constants";
import { ZustandStore } from "@acme/shared/common/classes";

export type NearbyLocationCenterType =
  | "self"
  | "search"
  | "manual-update"
  | "default"
  | "click"
  | "random";

const initialState = {
  // selectedItem: null as (GroupedMapData & WorkoutData) | null,
  zoom: DEFAULT_ZOOM,
  userGpsLocation: null as { latitude: number; longitude: number } | null,
  userGpsLocationStatus: "idle" as "loading" | "success" | "error" | "idle",
  userGpsLocationPermissions: "prompt" as PermissionState,

  userInitialIpLocation: null as {
    latitude: number;
    longitude: number;
  } | null,
  // bounds: null as google.maps.LatLngBoundsLiteral | null,
  center: {
    lat: DEFAULT_CENTER[0],
    lng: DEFAULT_CENTER[1],
  } as google.maps.LatLngLiteral,
  map: null as google.maps.Map | null,
  projection: null as google.maps.MapCanvasProjection | null,
  // This is updated in the map listener on pan and is used to convert latlng to container point - definitely a hack
  placeResultArea: null as string | null,
  placeResultLocation: null as google.maps.LatLngLiteral | null,
  updateLocation: null as google.maps.LatLngLiteral | null,
  nearbyLocationCenter: null as {
    lat: google.maps.LatLngLiteral["lat"];
    lng: google.maps.LatLngLiteral["lng"];
    name: string | null;
    type: NearbyLocationCenterType;
  } | null,
  modifiedLocationMarkers: {} as Record<number, { lat: number; lng: number }>,
  tiles: "street" as "street" | "hybrid",
  event: "idle" as "idle" | "drag" | "zoom",
  tilesLoaded: false,
  showDebug: false,
  loaded: false,
  hasMovedMap: false,
  // This allows us to be precise with zoom level when clicking on a cluster
  fractionalZoom: false,
  hasTriedInitialShowUserLocation: false,
  didSetQueryParamLocation: false,
};

export type MapStoreState = typeof initialState;

export const mapStore = new ZustandStore({
  initialState,
  persistOptions: {
    name: "map-store",
    version: 2,
    persistedKeys: ["center", "zoom"],
    getStorage: () => localStorage,
    onRehydrateStorage: (state) => {
      console.log("onRehydrateStorage map", state);
    },
  },
});
