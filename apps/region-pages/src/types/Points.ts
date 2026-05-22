export interface RawPointsEnvelope {
  range: string;
  majorDimension: string;
  values: string[][];
}

export interface RawPointDbItem {
  id?: string;
  entryId: string;
  regionId: string;
  data: RawPointData;
}

export interface RawPointData {
  group: string;
  time: string;
  type: string;
  region: string;
  website: string;
  notes: string;
  markerIcon: string;
  markerColor: string;
  iconColor: string;
  customSize: string;
  name: string;
  image: string;
  description: string;
  location: string;
  latitude: number;
  longitude: number;
  entryId: string;
}

export type RawPointDataJson = {
  [K in RawPointDataJsonKeys]: string | number;
};

export type RawPointDataJsonKeys =
  | 'Group'
  | 'Time'
  | 'Type'
  | 'Region'
  | 'Website'
  | 'Notes'
  | 'Marker Icon'
  | 'Marker Color'
  | 'Icon Color'
  | 'Custom Size'
  | 'Name'
  | 'Image'
  | 'Description'
  | 'Location'
  | 'Latitude'
  | 'Longitude'
  | 'Entry ID';
