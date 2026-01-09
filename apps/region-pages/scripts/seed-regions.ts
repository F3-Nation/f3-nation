import { eq, asc, and } from 'drizzle-orm';
import { kebabCase } from 'lodash';

import { db } from '../drizzle/db';
import { regions as regionsSchema } from '../drizzle/schema';
import { db as f3DataWarehouseDb } from '../drizzle/f3-data-warehouse/db';
import { orgs as orgsSchema } from '../drizzle/f3-data-warehouse/schema';
import { currentIngestedAt, isFresh } from './seed-state';

type Region = typeof regionsSchema.$inferInsert;

const DEFAULT_REGION_BATCH_SIZE = Number(
  process.env.REGION_SEED_BATCH_SIZE ?? '1000'
);

async function loadRegionIngestionMap() {
  const rows = await db
    .select({
      id: regionsSchema.id,
      lastIngestedAt: regionsSchema.lastIngestedAt,
    })
    .from(regionsSchema);

  return new Map<string, string | null>(
    rows.map((row) => [row.id, row.lastIngestedAt ?? null])
  );
}

export async function seedRegions() {
  const force = !!process.env.SEED_FORCE;

  console.debug('🔄 seeding regions...');
  const ingestedAt = currentIngestedAt();
  const lastIngestedById = await loadRegionIngestionMap();
  let skippedFresh = 0;
  let upserted = 0;
  const regions = fetchRegions();
  const batchSize = DEFAULT_REGION_BATCH_SIZE;
  const buffer: Region[] = [];
  let batchNumber = 0;

  for await (const region of regions) {
    const lastIngestedAt = lastIngestedById.get(region.id);
    if (!force && isFresh(lastIngestedAt)) {
      skippedFresh++;
      continue;
    }

    buffer.push(region);
    if (buffer.length >= batchSize) {
      batchNumber++;
      const batchLength = buffer.length;
      await upsertRegionBatch(
        buffer.map((item) => ({ ...item, lastIngestedAt: ingestedAt })),
        batchNumber
      );
      upserted += batchLength;
      buffer.length = 0;
    }
  }

  if (buffer.length) {
    batchNumber++;
    const batchLength = buffer.length;
    await upsertRegionBatch(
      buffer.map((item) => ({ ...item, lastIngestedAt: ingestedAt })),
      batchNumber
    );
    upserted += batchLength;
  }

  console.debug(
    `✅ done inserting regions (upserted=${upserted}, skippedFresh=${skippedFresh})`
  );
}

function transformTwitterUrl(twitter: string | null): string | null {
  if (!twitter) return null;

  // Match Twitter/X URLs with or without protocol, www, and trailing content
  const match = twitter.match(
    /^(?:@|%40)?([a-zA-Z0-9_]+)\s*$|^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:#!\/)?@?([a-zA-Z0-9_]+)(?:\/?|\?.*|#.*)?\s*$/i
  );

  if (!match) return null;

  // Use either the @handle or path component (groups 1 or 2)
  const handle = match[1] || match[2];
  return handle ? `https://x.com/${handle}` : null;
}

function transformFacebookUrl(facebook: string | null): string | null {
  if (!facebook) return null;

  // Handle Facebook profile URLs
  const profileMatch = facebook.match(
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([^\/?]+)(?:\/|$|\?)/i
  );
  if (profileMatch) {
    const handle = profileMatch[1];
    if (handle.startsWith('profile.php')) {
      return facebook; // Keep full profile URLs with IDs
    }
    if (/^[a-zA-Z0-9._-]+$/.test(handle)) {
      return `https://facebook.com/${handle}`;
    }
  }

  // Handle Facebook group URLs
  const groupMatch = facebook.match(
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/groups\/([^\/?]+)(?:\/|$|\?)/i
  );
  if (groupMatch) {
    const groupName = groupMatch[1];
    if (/^[a-zA-Z0-9._-]+$/.test(groupName)) {
      return `https://facebook.com/groups/${groupName}`;
    }
  }

  return null; // Invalid format
}

function transformInstagramUrl(instagram: string | null): string | null {
  if (!instagram) return null;

  // Handle full Instagram URLs
  const urlMatch = instagram.match(
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/i
  );
  if (urlMatch) {
    return `https://instagram.com/${urlMatch[1]}`;
  }

  // Handle bare handles (with or without @)
  const handleMatch = instagram.match(/^@?([a-zA-Z0-9._]+)$/);
  if (handleMatch) {
    return `https://instagram.com/${handleMatch[1]}`;
  }

  return null; // Invalid format
}

async function* fetchRegions(): AsyncGenerator<Region> {
  const regions = await f3DataWarehouseDb
    .select({
      id: orgsSchema.id,
      name: orgsSchema.name,
      description: orgsSchema.description,
      website: orgsSchema.website,
      logoUrl: orgsSchema.logoUrl,
      email: orgsSchema.email,
      facebook: orgsSchema.facebook,
      twitter: orgsSchema.twitter,
      instagram: orgsSchema.instagram,
    })
    .from(orgsSchema)
    .where(and(eq(orgsSchema.orgType, 'region'), eq(orgsSchema.isActive, true)))
    .orderBy(asc(orgsSchema.name));

  for await (const region of regions) {
    yield {
      id: region.id.toString(),
      name: region.name,
      description: region.description,
      slug: kebabCase(region.name),
      website: region.website,
      image: region.logoUrl,
      email: region.email?.includes('@') ? region.email.trim() : null,
      facebook: transformFacebookUrl(region.facebook),
      twitter: transformTwitterUrl(region.twitter),
      instagram: transformInstagramUrl(region.instagram),
      city: 'city',
      state: 'state',
      zip: 'zip',
      country: 'country',
      latitude: 0.5,
      longitude: -5.2,
      zoom: 10,
    } as Region;
  }
}

async function upsertRegionBatch(regions: Region[], batchNumber: number) {
  await Promise.all(
    regions.map((region) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { city, state, zip, country, latitude, longitude, zoom, ...rest } =
        region;
      return db
        .insert(regionsSchema)
        .values(region)
        .onConflictDoUpdate({
          target: [regionsSchema.id],
          set: rest,
        });
    })
  );
  console.debug(
    `📦 regions batch ${batchNumber}: upserted=${regions.length} (size=${DEFAULT_REGION_BATCH_SIZE})`
  );
}

const isMainModule = (import.meta as ImportMeta & { main?: boolean }).main;

if (isMainModule) {
  await seedRegions();
}
