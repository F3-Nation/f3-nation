/**
 * Placeholder region fixture used until the API is wired to the live database.
 * Keep entries synthetic to avoid committing PII or internal metadata.
 */
export type RegionRecord = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  zoom: number;
  zip: string | null;
  image: string | null;
  description: string | null;
  email: string | null;
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
};

export const REGIONS: RegionRecord[] = [
  {
    id: "demo-carolinas",
    name: "Demo Carolinas",
    slug: "demo-carolinas",
    website: "https://example.com/f3-carolinas",
    city: "Charlotte",
    state: "NC",
    country: "United States",
    latitude: 35.2271,
    longitude: -80.8431,
    zoom: 10,
    zip: null,
    image: null,
    description:
      "Placeholder record while this endpoint is wired to the database.",
    email: null,
    facebook: null,
    twitter: null,
    instagram: null,
  },
  {
    id: "demo-midwest",
    name: "Demo Midwest",
    slug: "demo-midwest",
    website: "https://example.com/f3-midwest",
    city: "Chicago",
    state: "IL",
    country: "United States",
    latitude: 41.8781,
    longitude: -87.6298,
    zoom: 9,
    zip: null,
    image: null,
    description: "Synthetic data for local development and smoke testing.",
    email: null,
    facebook: null,
    twitter: null,
    instagram: null,
  },
  {
    id: "demo-mountain",
    name: "Demo Mountain",
    slug: "demo-mountain",
    website: "https://example.com/f3-mountain",
    city: "Denver",
    state: "CO",
    country: "United States",
    latitude: 39.7392,
    longitude: -104.9903,
    zoom: 10,
    zip: null,
    image: null,
    description: "Synthetic data for local development and smoke testing.",
    email: null,
    facebook: null,
    twitter: null,
    instagram: null,
  },
  {
    id: "demo-southeast",
    name: "Demo Southeast",
    slug: "demo-southeast",
    website: "https://example.com/f3-southeast",
    city: "Atlanta",
    state: "GA",
    country: "United States",
    latitude: 33.749,
    longitude: -84.388,
    zoom: 10,
    zip: null,
    image: null,
    description: "Synthetic data for local development and smoke testing.",
    email: null,
    facebook: null,
    twitter: null,
    instagram: null,
  },
  {
    id: "demo-northeast",
    name: "Demo Northeast",
    slug: "demo-northeast",
    website: "https://example.com/f3-northeast",
    city: "Philadelphia",
    state: "PA",
    country: "United States",
    latitude: 39.9526,
    longitude: -75.1652,
    zoom: 10,
    zip: null,
    image: null,
    description: "Synthetic data for local development and smoke testing.",
    email: null,
    facebook: null,
    twitter: null,
    instagram: null,
  },
];
