import { sortWorkoutsByDayAndTime } from './workoutSorting';
import { WorkoutWithRegion } from '@/types/Workout';
import { Region } from '@/types/Region';
import fixtureData from './__fixtures__/Points.fixture.json';

// Mock current time for consistent testing
const MOCK_DATE = '2024-02-01T10:30:00'; // Thursday 10:30 AM

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'region';

const toNumber = (value?: string): number | undefined => {
  if (!value || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const createMockRegion = (overrides: Partial<Region> = {}): Region => ({
  id: overrides.id ?? 'region-test',
  name: overrides.name ?? 'Test Region',
  slug: overrides.slug ?? 'test-region',
  description: overrides.description,
  website: overrides.website,
  email: overrides.email,
  facebook: overrides.facebook,
  twitter: overrides.twitter,
  instagram: overrides.instagram,
  image: overrides.image,
  city: overrides.city,
  state: overrides.state,
  zip: overrides.zip,
  country: overrides.country,
  latitude: overrides.latitude,
  longitude: overrides.longitude,
  zoom: overrides.zoom,
});

const createWorkoutsFromFixture = (): WorkoutWithRegion[] => {
  const headers = fixtureData.values[0];
  return fixtureData.values.slice(1).map((row) => {
    const record = headers.reduce(
      (acc, header, index) => {
        acc[header] = row[index];
        return acc;
      },
      {} as Record<string, string>
    );

    const regionName = record.Region || 'Unknown Region';
    const regionSlug = slugify(regionName);
    const region = createMockRegion({
      id: `region-${regionSlug}`,
      name: regionName,
      slug: regionSlug,
      website: record.Website || undefined,
    });

    return {
      id: record['Entry ID'] || `fixture-${regionSlug}`,
      regionId: region.id,
      name: record.Name || 'Fixture Workout',
      time: record.Time || '00:00 AM',
      type: record.Type || 'Bootcamp',
      group: record.Group || 'Monday',
      notes: record.Notes || '',
      latitude: toNumber(record.Latitude),
      longitude: toNumber(record.Longitude),
      location: record.Location || '',
      image: record.Image || undefined,
      region,
    };
  });
};

const DEFAULT_REGION = createMockRegion();

const createWorkout = (
  day: string,
  time: string,
  id = '1',
  name = 'Test Workout',
  overrides: Partial<WorkoutWithRegion> = {}
): WorkoutWithRegion => {
  const region = overrides.region ?? DEFAULT_REGION;

  return {
    id: overrides.id ?? id,
    regionId: overrides.regionId ?? region.id,
    name: overrides.name ?? name,
    time: overrides.time ?? time,
    type: overrides.type ?? 'Bootcamp',
    group: overrides.group ?? day,
    notes: overrides.notes ?? 'Test Notes',
    latitude: overrides.latitude,
    longitude: overrides.longitude,
    location: overrides.location ?? 'Test Location',
    image: overrides.image,
    region,
  };
};

describe('sortWorkoutsByDayAndTime', () => {
  let originalDate: typeof Date;
  let originalConsoleError: typeof console.error;
  let mockCurrentDate: string = MOCK_DATE;

  beforeAll(() => {
    originalDate = global.Date;
    global.Date = class extends Date {
      constructor(date?: string) {
        if (date) {
          super(date);
        } else {
          super(mockCurrentDate);
        }
      }
      static now() {
        return new Date(mockCurrentDate).getTime();
      }
    } as typeof Date;

    originalConsoleError = console.error;
  });

  beforeEach(() => {
    mockCurrentDate = MOCK_DATE;
  });

  afterAll(() => {
    global.Date = originalDate;
    console.error = originalConsoleError;
  });

  test('sorts fixture workouts correctly', () => {
    const workouts = createWorkoutsFromFixture();
    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.id)).toEqual(['49282', '49269', '49297']);
    expect(sorted.map((w) => w.name)).toEqual([
      'The Grind',
      'The Factory',
      'The Keep',
    ]);
  });

  test('sorts workouts by next occurrence', () => {
    const workouts = [
      createWorkout('Friday', '05:15 AM - 06:00 AM', '1', 'The Grind'),
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '2', 'The Keep'),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.id)).toEqual(['1', '3', '2']);
  });

  test('moves past workouts to next week', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep'),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind'),
      createWorkout('Thursday', '11:30 AM - 12:30 PM', '3', 'Test AO'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.id)).toEqual(['3', '2', '1']);
  });

  test('handles empty workout list', () => {
    const workouts: WorkoutWithRegion[] = [];
    const sorted = sortWorkoutsByDayAndTime(workouts);
    expect(sorted).toEqual([]);
  });

  test('handles single workout', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep'),
    ];
    const sorted = sortWorkoutsByDayAndTime(workouts);
    expect(sorted).toEqual(workouts);
  });

  test('sorts workouts from different regions correctly', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        region: createMockRegion({ id: 'ftx', name: 'FTX', slug: 'ftx' }),
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        region: createMockRegion({
          id: 'menifee',
          name: 'Menifee',
          slug: 'menifee',
        }),
      }),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory', {
        region: createMockRegion({
          id: 'yorkshire',
          name: 'Yorkshire',
          slug: 'yorkshire',
        }),
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.region.name)).toEqual([
      'Menifee',
      'Yorkshire',
      'FTX',
    ]);
  });

  test('handles different workout types correctly', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        type: 'Bootcamp',
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        type: 'Ruck',
      }),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory', {
        type: 'Bootcamp',
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.type)).toEqual(['Ruck', 'Bootcamp', 'Bootcamp']);
  });

  test('handles workouts with location details', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        location: '26721 Hawks Prairie Blvd, Katy, TX, 77494, United States',
        latitude: 29.738579,
        longitude: -95.827298,
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        location: '28150 Keller Rd, Murrieta, CA, 92563, United States',
        latitude: 33.6273733,
        longitude: -117.167221,
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual(['The Grind', 'The Keep']);
  });

  test('handles workouts with website and notes', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        region: createMockRegion({
          id: 'ftx',
          name: 'FTX',
          slug: 'ftx',
          website: 'https://www.facebook.com/profile.php?id=100086109444523',
        }),
        notes: 'Look for the shovel flags near the bus cul-de-sac.',
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        region: createMockRegion({
          id: 'menifee',
          name: 'Menifee',
          slug: 'menifee',
          website: 'https://www.instagram.com/f3_menifee',
        }),
        notes: 'Meet at the hospital entrance on Mapleton Ave.',
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual(['The Grind', 'The Keep']);
  });

  test('handles workouts with marker customizations', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        image: 'media/shovel_flag_yellow.png',
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        image: 'media/shovel_flag_blue.png',
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual(['The Grind', 'The Keep']);
  });

  test('handles workouts with all fixture fields populated', () => {
    const workouts = createWorkoutsFromFixture();
    const firstWorkout = workouts[0];

    expect(firstWorkout).toHaveProperty('group');
    expect(firstWorkout).toHaveProperty('time');
    expect(firstWorkout).toHaveProperty('type');
    expect(firstWorkout).toHaveProperty('region');
    expect(firstWorkout).toHaveProperty('name');
    expect(firstWorkout).toHaveProperty('location');
    expect(firstWorkout).toHaveProperty('latitude');
    expect(firstWorkout).toHaveProperty('longitude');
    expect(firstWorkout).toHaveProperty('id');
    expect(firstWorkout.region).toHaveProperty('name');
  });

  test('handles early morning workouts correctly', () => {
    mockCurrentDate = '2024-02-01T04:30:00';

    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep'),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind'),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'The Keep',
      'The Grind',
      'The Factory',
    ]);
  });

  test('handles workouts with HTML in notes', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        notes:
          "<a href='https://www.google.com/maps/dir/?api=1&destination=26721 Hawks Prairie Blvd' target='_blank'>26721 Hawks Prairie Blvd</a>",
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        notes:
          "<a href='https://www.google.com/maps/dir/?api=1&destination=28150 Keller Rd' target='_blank'>28150 Keller Rd</a>",
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual(['The Grind', 'The Keep']);
  });

  test('handles workouts with social media links', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        region: createMockRegion({
          id: 'ftx',
          name: 'FTX',
          slug: 'ftx',
          website: 'https://www.facebook.com/profile.php?id=100086109444523',
        }),
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        region: createMockRegion({
          id: 'menifee',
          name: 'Menifee',
          slug: 'menifee',
          website: 'https://www.instagram.com/f3_menifee',
        }),
      }),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory', {
        region: createMockRegion({
          id: 'yorkshire',
          name: 'Yorkshire',
          slug: 'yorkshire',
          website: 'https://www.facebook.com/groups/452294467631888/',
        }),
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'The Grind',
      'The Factory',
      'The Keep',
    ]);
  });

  test('handles workouts with different marker icons', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        image: 'media/shovel_flag_yellow.png',
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        image: 'media/shovel_flag_blue.png',
      }),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory', {
        image: 'media/shovel_flag_red.png',
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'The Grind',
      'The Factory',
      'The Keep',
    ]);
  });

  test('handles workouts with location-specific notes', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'The Keep', {
        notes: 'Look for the shovel flags near the bus cul-de-sac.',
      }),
      createWorkout('Friday', '05:15 AM - 06:00 AM', '2', 'The Grind', {
        notes: 'Meet at the hospital entrance on Mapleton Ave.',
      }),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '3', 'The Factory', {
        notes: 'Assemble at the bottom entrance of Manston Park.',
      }),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'The Grind',
      'The Factory',
      'The Keep',
    ]);
  });

  test('falls back to midnight for blank or malformed times and sorts alphabetically on ties', () => {
    const workouts = [
      createWorkout('Thursday', '05:00 AM - 05:45 AM', '1', 'Late Start'),
      createWorkout('Thursday', '', '2', 'Alpha Midnight'),
      createWorkout('Thursday', 'sunrise', '3', 'Bravo Midnight'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'Alpha Midnight',
      'Bravo Midnight',
      'Late Start',
    ]);
  });

  test('converts 12 AM and afternoon times to the expected 24-hour order', () => {
    const workouts = [
      createWorkout('Friday', '12:15 AM - 01:00 AM', '1', 'Midnight Madness'),
      createWorkout('Friday', '06:00 AM - 06:45 AM', '2', 'Sunrise Beatdown'),
      createWorkout('Friday', '01:00 PM - 01:45 PM', '3', 'Lunch Club'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'Midnight Madness',
      'Sunrise Beatdown',
      'Lunch Club',
    ]);
  });

  test('rolls earlier-week workouts into the following week', () => {
    const workouts = [
      createWorkout('Friday', '05:15 AM - 06:00 AM', '1', 'Friday Fun'),
      createWorkout('Monday', '05:00 AM - 05:45 AM', '2', 'Monday Mayhem'),
      createWorkout('Tuesday', '05:00 AM - 05:45 AM', '3', 'Tuesday Thunder'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'Friday Fun',
      'Monday Mayhem',
      'Tuesday Thunder',
    ]);
  });

  test('pushes workouts with invalid day names to the end', () => {
    const workouts = [
      createWorkout('Friday', '05:15 AM - 06:00 AM', '1', 'Friday Fun'),
      createWorkout('Saturday', '06:30 AM - 07:15 AM', '2', 'Saturday Sweep'),
      {
        ...createWorkout(
          'Friday',
          '04:00 AM - 04:45 AM',
          '3',
          'Mystery Workout'
        ),
        group: 'Funday',
      },
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'Friday Fun',
      'Saturday Sweep',
      'Mystery Workout',
    ]);
  });

  test('treats workouts without a day as far-future entries', () => {
    const workouts = [
      createWorkout('Friday', '05:15 AM - 06:00 AM', '1', 'Friday Fun'),
      {
        ...createWorkout(
          'Friday',
          '04:00 AM - 04:45 AM',
          '2',
          'No Day Workout'
        ),
        group: '',
      },
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual(['Friday Fun', 'No Day Workout']);
  });

  test('handles workouts with unexpected time objects by defaulting to midnight', () => {
    const weirdTime = {
      split: () => [],
    } as unknown as string;

    const workouts = [
      createWorkout('Friday', '05:15 AM - 06:00 AM', '1', 'Friday Fun'),
      {
        ...createWorkout(
          'Friday',
          '06:00 AM - 06:45 AM',
          '2',
          'Unknown Format'
        ),
        time: weirdTime,
      },
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted[0].name).toBe('Unknown Format');
  });

  test('parses times without explicit minutes', () => {
    const workouts = [
      createWorkout('Friday', '5 AM - 6 AM', '1', 'Hour On The Hour'),
      createWorkout('Friday', '05:30 AM - 06:15 AM', '2', 'Morning Shift'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.map((w) => w.name)).toEqual([
      'Hour On The Hour',
      'Morning Shift',
    ]);
  });

  test('falls back to empty strings when workout names are missing', () => {
    const workouts = [
      {
        ...createWorkout('Friday', '05:00 AM - 05:45 AM', '1', ''),
        name: '',
      },
      {
        ...createWorkout('Friday', '05:00 AM - 05:45 AM', '2', ''),
        name: '',
      },
      createWorkout('Friday', '05:00 AM - 05:45 AM', '3', 'Named Workout'),
    ];

    const sorted = sortWorkoutsByDayAndTime(workouts);

    expect(sorted.slice(-1)[0].name).toBe('Named Workout');
    expect(sorted.slice(0, 2).every((workout) => workout.name === '')).toBe(
      true
    );
  });
});
