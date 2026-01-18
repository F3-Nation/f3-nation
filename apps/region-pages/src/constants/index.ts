export const DAYS_ORDER = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const SITE_CONFIG = {
  title: 'F3 Region Workouts',
  description: 'Find F3 workout locations and schedules in your region',
  url: process.env.NEXT_PUBLIC_URL || 'https://f3workouts.com',
} as const;
