/**
 * Add this new function before or after getBoundsOfLeaves
 *              NE: {lat:33, lng:-100}
 *
 * {lat:30, lng:-101} :SW
 *
 * (lng) east-west = 1
 * (lat) south-north = -3
 * 0.8 scale -> lngDelta = (1-0.8)/2*1 = 0.1, latDelta = (1-0.8)/2*3 = 0.3
 * newWest = -101 + 0.1 = -100.9
 * newEast = -100 - 0.1 = -100.1
 * newNorth = 33 - 0.3 = 32.7
 * newSouth = 30 + 0.3 = 30.3
 *
 *              NE: {lat:32.7, lng:-100.9}
 *
 * {lat:31.6, lng:-100.2} :SW
 *
 *  */
export const adjustBounds = (params: {
  bounds: google.maps.LatLngBounds;
  lngScale: number;
  latScale: number;
}) => {
  const { bounds, lngScale, latScale } = params;
  if (lngScale < 0) {
    throw new Error("lngScale must be greater than 0");
  }
  if (latScale < 0) {
    throw new Error("latScale must be greater than 0");
  }

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  // Get the current bounds
  const north = ne.lat();
  const east = ne.lng();
  const south = sw.lat();
  const west = sw.lng();

  // Calculate the new west and east coordinates
  const lngDelta = ((east - west) * (1 - lngScale)) / 2;
  const latDelta = ((south - north) * (1 - latScale)) / 2;
  const newWest = west + lngDelta;
  const newEast = east - lngDelta;
  const newNorth = north + latDelta;
  const newSouth = south - latDelta;

  // Create and return new bounds with reduced longitude
  const newBounds = new google.maps.LatLngBounds();
  newBounds.extend({ lat: newNorth, lng: newEast });
  newBounds.extend({ lat: newSouth, lng: newWest });

  return newBounds;
};
