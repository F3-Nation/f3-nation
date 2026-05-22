import { Region } from '@/types/Region';

export interface Workout {
  id: string;
  regionId: string;
  name: string;
  time: string;
  type: string;
  types?: string[];
  group: string;
  image?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
}

export interface WorkoutWithRegion extends Workout {
  region: Region;
}
