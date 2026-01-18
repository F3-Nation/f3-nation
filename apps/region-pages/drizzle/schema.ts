import {
  pgTable,
  varchar,
  integer,
  doublePrecision,
  timestamp,
  text,
} from 'drizzle-orm/pg-core';

export const regions = pgTable('regions', {
  id: varchar().primaryKey(),
  slug: varchar().unique(),
  name: varchar().notNull().unique(),
  description: varchar(),
  website: varchar(),
  image: varchar(),
  city: varchar(),
  state: varchar(),
  zip: varchar(),
  country: varchar(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  zoom: integer(),
  email: varchar(),
  facebook: varchar(),
  twitter: varchar(),
  instagram: varchar(),
  lastIngestedAt: timestamp('last_ingested_at', { mode: 'string' }),
});

export const workouts = pgTable('workouts', {
  id: varchar().primaryKey(),
  regionId: varchar('region_id').references(() => regions.id),
  name: varchar().notNull(),
  time: varchar().notNull(),
  type: varchar().notNull(),
  group: varchar().notNull(),
  notes: varchar(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  city: varchar(),
  state: varchar(),
  zip: varchar(),
  country: varchar(),
  location: varchar(),
  types: text('types').array(),
  lastIngestedAt: timestamp('last_ingested_at', { mode: 'string' }),
});

export const seedRuns = pgTable('seed_runs', {
  key: varchar().primaryKey(),
  lastIngestedAt: timestamp('last_ingested_at', { mode: 'string' }).notNull(),
});
