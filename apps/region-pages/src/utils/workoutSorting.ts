import { WorkoutWithRegion } from '@/types/Workout';

// Calendar constants
export const DAYS_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const mondayBasedDayIndex = (date: Date): number => (date.getDay() + 6) % 7;

const dayToIndex = (day: string): number => {
  if (!day) return -1;
  const normalized = day.trim().toLowerCase();
  return DAYS_ORDER.findIndex((value) => value.toLowerCase() === normalized);
};

const parseStartTime = (time?: string): { hours: number; minutes: number } => {
  if (!time) {
    return { hours: 0, minutes: 0 };
  }

  const start = time.split('-')[0]?.trim() ?? '';
  const match = start.toUpperCase().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/);

  if (!match) {
    return { hours: 0, minutes: 0 };
  }

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3];

  if (period === 'AM') {
    if (hours === 12) hours = 0;
  } else if (hours !== 12) {
    hours += 12;
  }

  return { hours, minutes };
};

const nextOccurrenceTimestamp = (
  workout: WorkoutWithRegion,
  reference: Date
): number => {
  const workoutDayIndex = dayToIndex(workout.group);

  if (workoutDayIndex === -1) {
    return Number.MAX_SAFE_INTEGER;
  }

  const { hours, minutes } = parseStartTime(workout.time);
  const occurrence = new Date(reference);
  occurrence.setHours(hours, minutes, 0, 0);

  const currentDayIndex = mondayBasedDayIndex(reference);
  let dayOffset = workoutDayIndex - currentDayIndex;

  if (dayOffset < 0) {
    dayOffset += 7;
  }

  occurrence.setDate(occurrence.getDate() + dayOffset);

  // If the workout has already happened today, push it to next week
  if (dayOffset === 0 && occurrence < reference) {
    occurrence.setDate(occurrence.getDate() + 7);
  }

  return occurrence.getTime();
};

/**
 * Sort workouts by next occurrence considering current day and start time.
 * Past workouts for the current day are moved to next week.
 */
export const sortWorkoutsByDayAndTime = (
  workouts: WorkoutWithRegion[]
): WorkoutWithRegion[] => {
  const now = new Date();

  return [...workouts].sort((a, b) => {
    const nextA = nextOccurrenceTimestamp(a, now);
    const nextB = nextOccurrenceTimestamp(b, now);

    if (nextA !== nextB) {
      return nextA - nextB;
    }

    return (a.name || '').localeCompare(b.name || '');
  });
};
