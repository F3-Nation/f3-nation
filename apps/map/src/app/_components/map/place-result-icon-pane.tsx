import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { MapPinIcon } from "lucide-react";

import { Z_INDEX } from "@acme/shared/app/constants";

import { mapStore } from "~/utils/store/map";

export const PlaceResultIconPane = () => {
  const placeResultLocation = mapStore.use.placeResultLocation();

  return (
    <div style={{ zIndex: Z_INDEX.PLACE_RESULTS_ICON_PANE }}>
      {placeResultLocation ? (
        <AdvancedMarker position={placeResultLocation}>
          <MapPinIcon className="size-8 fill-red-600 text-foreground" />
        </AdvancedMarker>
      ) : null}
    </div>
  );
};
