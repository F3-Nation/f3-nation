import type { GeoMapSearchResult } from "./types";
import { placesDetails } from "./places-details";
import { setView } from "./set-view";
import { filterStore } from "./store/filter";
import { mapStore } from "./store/map";
import { searchStore } from "./store/search";
import { setSelectedItem } from "./store/selected-item";

export const onClickPlaceRowMap = (result: GeoMapSearchResult) => {
  searchStore.setState({ shouldShowResults: false });
  setSelectedItem({ locationId: null, eventId: null, showPanel: false });
  void placesDetails(result.destination.placeId).then((place) => {
    const latitude = place.location.latitude;
    const longitude = place.location.longitude;
    mapStore.setState({
      placeResultArea: place.displayName.text,
      placeResultLocation: { lat: latitude, lng: longitude },
      nearbyLocationCenter: {
        lat: latitude,
        lng: longitude,
        name: result.header,
        type: "search",
      },
    });
    setView({ lat: latitude, lng: longitude });
    filterStore.setState({ position: { latitude, longitude } });
  });
};
