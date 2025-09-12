import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
} from "@vis.gl/react-google-maps";

import { Z_INDEX } from "@acme/shared/app/constants";
import { TestId } from "@acme/shared/common/enums";

import { mapStore } from "~/utils/store/map";

export const GeolocationMarker = () => {
  const userGpsLocation = mapStore.use.userGpsLocation();
  const userGpsLocationStatus = mapStore.use.userGpsLocationStatus();
  return userGpsLocationStatus !== "success" || !userGpsLocation ? null : (
    <AdvancedMarker
      anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
      position={{
        lat: userGpsLocation.latitude,
        lng: userGpsLocation.longitude,
      }}
      zIndex={Z_INDEX.GEOLOCATION_MARKER}
    >
      <svg
        data-testid={TestId.GEOLOCATION_MARKER}
        width="40"
        height="40"
        viewBox="0 0 40 40"
      >
        {/* Larger transparent blue circle for accuracy/range indication */}
        <circle cx="20" cy="20" r="18" fill="#4285F4" fillOpacity="0.2" />
        {/* Main blue dot */}
        <circle
          cx="20"
          cy="20"
          r="8"
          fill="#4285F4"
          stroke="#FFFFFF"
          strokeWidth="2"
        />
      </svg>
    </AdvancedMarker>
  );
};
