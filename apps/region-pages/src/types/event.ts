interface EventLocation {
  name?: string;
  address?: string;
  url?: string;
  notes?: string;
}

interface EventScheduleItem {
  label: string;
  time?: string;
}

interface EventContact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  slack?: string;
}

interface EventCallToAction {
  label: string;
  url: string;
}

export interface RegionEvent {
  id: string;
  slugSuffix?: string;
  legacySlugs?: string[];
  title: string;
  headline?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type?: string;
  summary?: string;
  highlights?: string[];
  schedule?: EventScheduleItem[];
  contacts?: EventContact[];
  location?: EventLocation;
  cta?: EventCallToAction;
  image?: string;
}

export interface RegionEventsEntry {
  regionSlug: string;
  regionName?: string;
  events: RegionEvent[];
}
