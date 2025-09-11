"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

import { isDevelopment, RERENDER_LOGS } from "@acme/shared/common/constants";

import { setView } from "~/utils/set-view";
import { mapStore } from "~/utils/store/map";

const UserLocationContext = createContext<{
  status: "loading" | "error" | "success" | "idle";
  permissions: PermissionState | null;
  attemptToNavigateToUserLocation: () => Promise<void>;
}>({
  status: "loading",
  permissions: null,
  attemptToNavigateToUserLocation: () => Promise.resolve(),
});

const USER_LOCATION_LOGS = false as boolean;
const USE_FAKE_LOCATION = false as boolean;

export const UserLocationProvider = ({ children }: { children: ReactNode }) => {
  RERENDER_LOGS && console.log("UserLocationProvider rerender");
  const hasTriedInitialShowUserLocation = useRef(false);
  const userGpsLocationStatus = mapStore.use.userGpsLocationStatus();
  const userGpsLocationPermissions = mapStore.use.userGpsLocationPermissions();
  const setPermissions = (permissionState: PermissionState) => {
    mapStore.setState({ userGpsLocationPermissions: permissionState });
  };
  const setStatus = (status: "loading" | "error" | "success" | "idle") => {
    mapStore.setState({ userGpsLocationStatus: status });
  };

  /**
   * 1. Get permission
   * 2. Get location
   * 3. Update map
   */
  const attemptToNavigateToUserLocation = useCallback(
    async (params?: { onlyUpdateIfNotHasMovedMap?: boolean }) => {
      USER_LOCATION_LOGS && console.log("attemptToNavigateToUserLocation");
      try {
        // 1. Get permission
        const permissionState = await getGeolocationPermission();
        USER_LOCATION_LOGS && console.log("permissionState", permissionState);
        setPermissions(permissionState);
        if (permissionState === "denied") {
          setStatus("error");
          return;
        }

        // 2. Get location
        let position = mapStore.get("userGpsLocation");
        USER_LOCATION_LOGS && console.log("mapStore position", position);

        const geoLocation = await getGeolocationPosition();
        USER_LOCATION_LOGS && console.log("geoLocationCache", geoLocation);

        if (geoLocation) {
          setPermissions("granted");
          position ??= {
            latitude: geoLocation.coords.latitude,
            longitude: geoLocation.coords.longitude,
          };
        }

        USER_LOCATION_LOGS && console.log("final position", position);
        if (!position) {
          throw new Error("No position");
        }
        setStatus("success");

        // 3. Update map
        setView({
          lat: position.latitude,
          lng: position.longitude,
          zoom: 15,
          options: { onlyIfNotMovedMap: params?.onlyUpdateIfNotHasMovedMap },
        });
      } catch (error) {
        USER_LOCATION_LOGS &&
          console.error("Error navigating to user location", error);
        setStatus("error");
      }
    },
    [],
  );

  // Initial load
  useEffect(() => {
    USER_LOCATION_LOGS && console.log("UserLocationProvider initial useEffect");
    setStatus("loading");

    const loadLocationAndUpdateMap = async () => {
      const permissionState = await getGeolocationPermission();
      if (permissionState === "denied") return;
      let position = mapStore.get("userGpsLocation");

      if (!position) {
        const geoLocation = await getGeolocationPosition({ timeout: 10000 });
        if (!geoLocation) return;
        position = {
          latitude: geoLocation.coords.latitude,
          longitude: geoLocation.coords.longitude,
        };
      }

      if (
        position &&
        !hasTriedInitialShowUserLocation.current &&
        mapStore.get("didSetQueryParamLocation") === false
      ) {
        hasTriedInitialShowUserLocation.current = true;

        setView({
          lat: position.latitude,
          lng: position.longitude,
          zoom: 15,
          options: { onlyIfNotMovedMap: true },
        });
      }
    };

    // React recommendation is to make async fn then call it in useEffect
    void loadLocationAndUpdateMap()
      .then(() => {
        setStatus("success");
      })
      .catch(() => {
        setStatus("error");
      });
  }, []);

  return (
    <UserLocationContext.Provider
      value={{
        attemptToNavigateToUserLocation,
        status: userGpsLocationStatus,
        permissions: userGpsLocationPermissions,
      }}
    >
      {children}
    </UserLocationContext.Provider>
  );
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getCurrentLocationCache =
  async (): Promise<GeolocationPosition | null> => {
    try {
      const position = await getGeolocationPosition({ timeout: 1 });
      return position;
    } catch (error) {
      return null;
    }
  };

const getGeolocationPermission = (): Promise<PermissionState> => {
  return new Promise((resolve, reject) => {
    navigator.permissions
      .query({ name: "geolocation" })
      .then((result) => {
        resolve(result.state);
      })
      .catch((error) => {
        reject(error);
      });
  });
};

const getFakeGeolocationPosition = (
  _options?: PositionOptions,
): Promise<GeolocationPosition> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const position = {
        coords: {
          latitude: 37.774929,
          longitude: -122.419418,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };
      mapStore.setState({
        userGpsLocationStatus: "success",
        userGpsLocation: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
      });
      resolve(position);
    }, 1000);
  });
};
const getGeolocationPosition = (
  options?: PositionOptions,
): Promise<GeolocationPosition> => {
  if (isDevelopment && USE_FAKE_LOCATION) {
    console.log("getGeolocationPosition fake location");
    return getFakeGeolocationPosition(options);
  }
  mapStore.setState({ userGpsLocationStatus: "loading" });
  return new Promise((resolve, reject) => {
    USER_LOCATION_LOGS && console.log("getCurrentPositionPromise");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        USER_LOCATION_LOGS &&
          console.log("getCurrentPositionPromise", { position });
        mapStore.setState({
          userGpsLocationStatus: "success",
          userGpsLocation: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        });
        resolve(position);
      },
      (error) => {
        USER_LOCATION_LOGS &&
          console.log("getCurrentPositionPromise", { error });
        mapStore.setState({ userGpsLocationStatus: "error" });
        reject(error);
      },
      {
        timeout: options?.timeout ?? 1000 * 60, // 1 minute
        enableHighAccuracy: options?.enableHighAccuracy ?? false,
        maximumAge: options?.maximumAge ?? 1000 * 60 * 60 * 24 * 30, // 30 days
      },
    );
  });
};

export const useUserLocation = () => {
  return useContext(UserLocationContext);
};
// const userInitialIpLocation = mapStore.use.userInitialIpLocation();

// const userLocation = userGpsLocation ?? userInitialIpLocation;

// TODO: Orchestrate these two location requests
// Only get the ip location if the user location is not yet permitted, is not being requested, or failed

// Try to get the location right away

// useEffect(() => {
//   if (hasRequestedLocation.current) return;
//   hasRequestedLocation.current = true;

//   void axios
//     .get<{
//       ip: string;
//     }>("https://api64.ipify.org?format=json")
//     .then((res) => res.data)
//     .then((data) =>
//       axios.get<{
//         geoplugin_status: number; // 200;
//         geoplugin_request: string; // "71.71.123.153";
//         geoplugin_delay: string; // "1ms";
//         geoplugin_credit: string; // "Some of the returned data includes GeoLite2 data created by MaxMind, available from <a href='https://www.maxmind.com'>https://www.maxmind.com</a>.";
//         geoplugin_city: string; // "Elkin";
//         geoplugin_region: string; // "North Carolina";
//         geoplugin_regionCode: string; // "NC";
//         geoplugin_regionName: string; // "North Carolina";
//         geoplugin_areaCode: string; // "";
//         geoplugin_dmaCode: string; // "518";
//         geoplugin_countryCode: string; // "US";
//         geoplugin_countryName: string; // "United States";
//         geoplugin_inEU: number; // 0;
//         geoplugin_euVATrate: boolean; //false;
//         geoplugin_continentCode: string; // "NA";
//         geoplugin_continentName: string; // "North America";
//         geoplugin_latitude: string; // "36.2867";
//         geoplugin_longitude: string; // "-80.86";
//         geoplugin_locationAccuracyRadius: string; // "5";
//         geoplugin_timezone: string; // "America/New_York";
//         geoplugin_currencyCode: string; // "USD";
//         geoplugin_currencySymbol: string; // "$";
//         geoplugin_currencySymbol_UTF8: string; // "$";
//         geoplugin_currencyConverter: number; // 0;
//       }>(`http://www.geoplugin.net/json.gp?ip=${data.ip}`),
//     )
//     .then((res) => {
//       const latitude = safeParseFloat(res.data.geoplugin_latitude);
//       const longitude = safeParseFloat(res.data.geoplugin_longitude);
//       if (longitude !== undefined && latitude !== undefined) {
//         mapStore.setState({
//           userInitialIpLocation: {
//             latitude,
//             longitude,
//           },
//         });
//       }
//     });
// }, []);
