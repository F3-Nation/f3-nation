import { eq, asc, and, gt, gte, or, inArray } from 'drizzle-orm';

import { db } from '../drizzle/db';
import {
  regions as regionsSchema,
  workouts as workoutsSchema,
} from '../drizzle/schema';
import { db as f3DataWarehouseDb } from '../drizzle/f3-data-warehouse/db';
import {
  orgs as orgsSchema,
  events as eventsSchema,
  locations as locationsSchema,
  eventsXEventTypes as eventsXEventTypesSchema,
  eventTypes as eventTypesSchema,
} from '../drizzle/f3-data-warehouse/schema';
import { currentIngestedAt, isFresh } from './seed-state';

type Workout = typeof workoutsSchema.$inferInsert;

type Cursor = {
  updated: string;
  id: number;
};

type SeedOptions = {
  batchSize: number;
  maxBatches?: number;
  updatedAfter?: string;
};

const DEFAULT_BATCH_SIZE = Number(
  process.env.WORKOUT_SEED_BATCH_SIZE ?? '1000'
);
const DEFAULT_MAX_BATCHES = process.env.WORKOUT_SEED_MAX_BATCHES
  ? Number(process.env.WORKOUT_SEED_MAX_BATCHES)
  : undefined;
const DEFAULT_UPDATED_AFTER = process.env.WORKOUT_SEED_UPDATED_AFTER;
const UPSERT_CONCURRENCY = Math.max(
  1,
  Number(process.env.WORKOUT_SEED_UPSERT_CONCURRENCY ?? '8')
);

async function loadWorkoutIngestionMap() {
  const rows = await db
    .select({
      id: workoutsSchema.id,
      lastIngestedAt: workoutsSchema.lastIngestedAt,
    })
    .from(workoutsSchema);

  return new Map<string, string | null>(
    rows.map((row) => [row.id, row.lastIngestedAt ?? null])
  );
}

export async function seedWorkouts(opts: Partial<SeedOptions> = {}) {
  const force = !!process.env.SEED_FORCE;

  console.debug('🔄 seeding workouts with batched incremental loader...');
  const ingestedAt = currentIngestedAt();
  const lastIngestedById = await loadWorkoutIngestionMap();

  const options: SeedOptions = {
    batchSize: Number.isFinite(opts.batchSize)
      ? Number(opts.batchSize)
      : DEFAULT_BATCH_SIZE,
    maxBatches: opts.maxBatches ?? DEFAULT_MAX_BATCHES ?? undefined,
    updatedAfter: opts.updatedAfter ?? DEFAULT_UPDATED_AFTER ?? undefined,
  };

  if (Number.isNaN(options.batchSize) || options.batchSize <= 0) {
    throw new Error(
      `WORKOUT_SEED_BATCH_SIZE must be a positive number. Got ${opts.batchSize}`
    );
  }

  const normalizedUpdatedAfter =
    options.updatedAfter && !Number.isNaN(Date.parse(options.updatedAfter))
      ? new Date(options.updatedAfter).toISOString()
      : undefined;
  if (options.updatedAfter && !normalizedUpdatedAfter) {
    console.warn(
      `⚠️ ignoring invalid WORKOUT_SEED_UPDATED_AFTER="${options.updatedAfter}"`
    );
  }

  const supabaseRegionIds = await loadSupabaseRegionIds();
  console.debug(
    `📌 seed config -> batchSize=${options.batchSize}, updatedAfter=${normalizedUpdatedAfter ?? 'none'}, maxBatches=${options.maxBatches ?? 'unbounded'}`
  );

  let cursor: Cursor | null = null;
  let totalInserted = 0;
  let batchNumber = 0;
  while (true) {
    if (options.maxBatches && batchNumber >= options.maxBatches) {
      console.debug(
        `⏭️ stopping after ${batchNumber} batch(es) per maxBatches config`
      );
      break;
    }

    const { workouts, nextCursor, skipped } = await fetchWorkoutsBatch({
      cursor,
      batchSize: options.batchSize,
      updatedAfter: normalizedUpdatedAfter,
      supabaseRegionIds,
      lastIngestedById,
      ingestedAt,
      force,
    });

    if (!workouts.length && !nextCursor) {
      console.debug('✅ no more workouts to process');
      break;
    }

    if (workouts.length) {
      await upsertWorkouts(workouts);
      totalInserted += workouts.length;
    }

    batchNumber++;
    cursor = nextCursor;

    console.debug(
      `📦 batch ${batchNumber}: upserted=${workouts.length}, skipped=${skipped.total}` +
        (skipped.total
          ? ` (missingType=${skipped.missingType}, missingAo=${skipped.missingAo}, missingRegion=${skipped.missingRegion}, missingGroup=${skipped.missingGroup}, missingLocation=${skipped.missingLocation}, fresh=${skipped.fresh})`
          : '')
    );

    if (!nextCursor) break;
  }

  console.debug(
    `✅ done inserting workouts (total upserted: ${totalInserted} across ${batchNumber} batch(es))`
  );
}

async function loadSupabaseRegionIds() {
  const regions = await db.select({ id: regionsSchema.id }).from(regionsSchema);
  return new Set(regions.map((region) => region.id));
}

async function upsertWorkouts(workouts: Workout[]) {
  for (let i = 0; i < workouts.length; i += UPSERT_CONCURRENCY) {
    const chunk = workouts.slice(i, i + UPSERT_CONCURRENCY);
    await Promise.all(
      chunk.map((workout) =>
        db
          .insert(workoutsSchema)
          .values(workout)
          .onConflictDoUpdate({
            target: [workoutsSchema.id],
            set: workout,
          })
      )
    );
  }
}

type BatchResult = {
  workouts: Workout[];
  nextCursor: Cursor | null;
  skipped: {
    total: number;
    missingType: number;
    missingAo: number;
    missingRegion: number;
    missingLocation: number;
    missingGroup: number;
    fresh: number;
  };
};

type FetchBatchArgs = {
  cursor: Cursor | null;
  batchSize: number;
  updatedAfter?: string;
  supabaseRegionIds: Set<string>;
  lastIngestedById: Map<string, string | null>;
  ingestedAt: string;
  force: boolean;
};

async function fetchWorkoutsBatch(args: FetchBatchArgs): Promise<BatchResult> {
  const conditions = [eq(eventsSchema.isActive, true)];
  if (args.updatedAfter) {
    conditions.push(gte(eventsSchema.updated, args.updatedAfter));
  }

  if (args.cursor) {
    const cursorClause = or(
      gt(eventsSchema.updated, args.cursor.updated),
      and(
        eq(eventsSchema.updated, args.cursor.updated),
        gt(eventsSchema.id, args.cursor.id)
      )
    );

    if (cursorClause) {
      conditions.push(cursorClause);
    }
  }

  const whereClause =
    conditions.length > 1 ? and(...conditions) : conditions[0];

  const baseRows = await f3DataWarehouseDb
    .select({
      id: eventsSchema.id,
      aoId: eventsSchema.orgId,
      locationId: eventsSchema.locationId,
      name: eventsSchema.name,
      notes: eventsSchema.description,
      startTime: eventsSchema.startTime,
      endTime: eventsSchema.endTime,
      group: eventsSchema.dayOfWeek,
      updated: eventsSchema.updated,
    })
    .from(eventsSchema)
    .where(whereClause)
    .orderBy(asc(eventsSchema.updated), asc(eventsSchema.id))
    .limit(args.batchSize);

  if (!baseRows.length) {
    return {
      workouts: [],
      nextCursor: null,
      skipped: {
        total: 0,
        missingAo: 0,
        missingLocation: 0,
        missingRegion: 0,
        missingType: 0,
        missingGroup: 0,
        fresh: 0,
      },
    };
  }

  const eventIds = baseRows.map((row) => row.id);
  const aoIds = Array.from(new Set(baseRows.map((row) => row.aoId)));
  const locationIds = Array.from(
    new Set(
      baseRows
        .map((row) => row.locationId)
        .filter((locationId) => locationId !== null)
    )
  );

  const eventTypeLookups =
    eventIds.length > 0
      ? await f3DataWarehouseDb
          .select({
            eventId: eventsXEventTypesSchema.eventId,
            eventTypeId: eventsXEventTypesSchema.eventTypeId,
          })
          .from(eventsXEventTypesSchema)
          .where(inArray(eventsXEventTypesSchema.eventId, eventIds))
      : [];
  const eventTypeIds = Array.from(
    new Set(eventTypeLookups.map((lookup) => lookup.eventTypeId))
  );
  const eventTypeIdsByEvent = new Map<number, number[]>();
  for (const lookup of eventTypeLookups) {
    if (!eventTypeIdsByEvent.has(lookup.eventId)) {
      eventTypeIdsByEvent.set(lookup.eventId, []);
    }
    eventTypeIdsByEvent.get(lookup.eventId)!.push(lookup.eventTypeId);
  }
  const eventTypes =
    eventTypeIds.length > 0
      ? await f3DataWarehouseDb
          .select({
            id: eventTypesSchema.id,
            name: eventTypesSchema.name,
          })
          .from(eventTypesSchema)
          .where(inArray(eventTypesSchema.id, eventTypeIds))
      : [];

  const aos =
    aoIds.length > 0
      ? await f3DataWarehouseDb
          .select({
            id: orgsSchema.id,
            name: orgsSchema.name,
            parentId: orgsSchema.parentId,
            orgType: orgsSchema.orgType,
            isActive: orgsSchema.isActive,
          })
          .from(orgsSchema)
          .where(inArray(orgsSchema.id, aoIds))
      : [];
  const regionIds = Array.from(
    new Set(
      aos
        .map((ao) => ao.parentId)
        .filter((parentId): parentId is number => parentId !== null)
    )
  );
  const regions =
    regionIds.length > 0
      ? await f3DataWarehouseDb
          .select({
            id: orgsSchema.id,
            name: orgsSchema.name,
            orgType: orgsSchema.orgType,
            isActive: orgsSchema.isActive,
          })
          .from(orgsSchema)
          .where(inArray(orgsSchema.id, regionIds))
      : [];

  const locations =
    locationIds.length > 0
      ? await f3DataWarehouseDb
          .select({
            id: locationsSchema.id,
            latitude: locationsSchema.latitude,
            longitude: locationsSchema.longitude,
            address1: locationsSchema.addressStreet,
            address2: locationsSchema.addressStreet2,
            city: locationsSchema.addressCity,
            state: locationsSchema.addressState,
            zip: locationsSchema.addressZip,
            country: locationsSchema.addressCountry,
          })
          .from(locationsSchema)
          .where(inArray(locationsSchema.id, locationIds))
      : [];

  const eventTypeNameById = new Map(
    eventTypes.map((type) => [type.id, type.name])
  );
  const aoById = new Map(aos.map((ao) => [ao.id, ao]));
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const locationById = new Map(
    locations.map((location) => [location.id, location])
  );

  const assembled: Workout[] = [];
  const skipped = {
    total: 0,
    missingType: 0,
    missingAo: 0,
    missingRegion: 0,
    missingLocation: 0,
    missingGroup: 0,
    fresh: 0,
  };

  for (const row of baseRows) {
    if (!args.force) {
      const lastIngestedAt =
        args.lastIngestedById.get(row.id.toString()) ?? null;
      if (isFresh(lastIngestedAt)) {
        skipped.total++;
        skipped.fresh++;
        continue;
      }
    }

    const eventTypeIdsForEvent = eventTypeIdsByEvent.get(row.id) ?? [];
    const eventTypeNames = eventTypeIdsForEvent
      .map((id) => eventTypeNameById.get(id))
      .filter((name): name is string => !!name);
    if (!eventTypeNames.length) {
      skipped.total++;
      skipped.missingType++;
      continue;
    }
    const primaryType = eventTypeNames[0];

    const ao = aoById.get(row.aoId);
    if (!ao || ao.orgType !== 'ao' || !ao.isActive) {
      skipped.total++;
      skipped.missingAo++;
      continue;
    }

    const region = ao.parentId ? regionById.get(ao.parentId) : null;
    if (
      !region ||
      region.orgType !== 'region' ||
      !region.isActive ||
      !args.supabaseRegionIds.has(region.id.toString())
    ) {
      skipped.total++;
      skipped.missingRegion++;
      continue;
    }

    if (!row.group) {
      skipped.total++;
      skipped.missingGroup++;
      continue;
    }

    const location = row.locationId
      ? locationById.get(row.locationId)
      : undefined;
    if (!location) {
      skipped.total++;
      skipped.missingLocation++;
      continue;
    }

    const formattedLocation = [
      location.address1,
      location.address2,
      location.city,
      location.state,
      location.zip,
      location.country,
    ]
      .filter(Boolean)
      .map((item) => item?.trim())
      .join(', ')
      .trim();

    const timeRange =
      row.startTime && row.endTime
        ? `${row.startTime} - ${row.endTime}`
        : (row.startTime ?? row.endTime ?? '');

    assembled.push({
      id: row.id.toString(),
      regionId: region.id.toString(),
      name: row.name,
      time: timeRange,
      type: primaryType,
      types: eventTypeNames,
      group: row.group,
      notes: row.notes,
      latitude: location.latitude,
      longitude: location.longitude,
      city: location.city,
      state: location.state,
      zip: location.zip,
      country: location.country,
      location: formattedLocation,
      lastIngestedAt: args.ingestedAt,
    });
  }

  const lastRow = baseRows[baseRows.length - 1];
  const nextCursor = lastRow
    ? { updated: lastRow.updated, id: lastRow.id }
    : null;

  return { workouts: assembled, nextCursor, skipped };
}

if (import.meta.main) {
  await seedWorkouts();
}
