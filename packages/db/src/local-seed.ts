/**
 * Local development seed script.
 *
 * Populates the database with a realistic (but entirely fictional, non-PII)
 * F3 org hierarchy so the map app is immediately useful after first-time setup.
 *
 * Safe to re-run — all inserts use onConflictDoNothing().
 *
 * Run with:  pnpm db:seed:local
 *
 * To add your own data, extend the arrays below and re-run the script.
 */

import { EventTypes, RegionRole } from "@acme/shared/app/enums";

import { and, eq, sql } from ".";
import { authSchema, schema } from ".";
import { db } from "./client";

// ---------------------------------------------------------------------------
// Org hierarchy
// ---------------------------------------------------------------------------

const NATION = {
  name: "F3 Nation",
  orgType: "nation" as const,
  isActive: true,
  website: "https://f3nation.com",
  email: "info@f3nation.com",
  description: "The F3 Nation — Fitness, Fellowship, Faith",
};

const SECTORS = [
  {
    name: "F3 Southeast",
    orgType: "sector" as const,
    isActive: true,
    description: "Southeast Sector",
  },
];

const AREAS = [
  {
    name: "F3 Western NC",
    orgType: "area" as const,
    isActive: true,
    sectorName: "F3 Southeast",
    description: "Western North Carolina Area",
  },
  {
    name: "F3 Metrolina",
    orgType: "area" as const,
    isActive: true,
    sectorName: "F3 Southeast",
    description: "Charlotte Metro Area",
  },
];

// Regions must include "Boone" — the existing seed.ts insertUsers() expects it.
const REGIONS = [
  {
    name: "Boone",
    orgType: "region" as const,
    isActive: true,
    areaName: "F3 Western NC",
    email: "f3boone@f3nation.com",
    website: "https://f3boone.com",
    description: "F3 Boone — High Country NC",
  },
  {
    name: "F3 Charlotte",
    orgType: "region" as const,
    isActive: true,
    areaName: "F3 Metrolina",
    email: "f3charlotte@f3nation.com",
    website: "https://f3charlotte.com",
    description: "F3 Charlotte — Queen City",
  },
];

// AOs with lat/long so they show on the map
const AOS = [
  // Boone AOs (around 36.21, -81.67)
  {
    name: "The Dark Tower",
    orgType: "ao" as const,
    isActive: true,
    regionName: "Boone",
    description: "Boone's flagship AO",
    latitude: 36.2168,
    longitude: -81.6746,
    addressCity: "Boone",
    addressState: "NC",
  },
  {
    name: "The Viaduct",
    orgType: "ao" as const,
    isActive: true,
    regionName: "Boone",
    description: "Trail-focused AO",
    latitude: 36.2098,
    longitude: -81.6801,
    addressCity: "Boone",
    addressState: "NC",
  },
  // Charlotte AOs (around 35.22, -80.84)
  {
    name: "The Colosseum",
    orgType: "ao" as const,
    isActive: true,
    regionName: "F3 Charlotte",
    description: "Uptown Charlotte AO",
    latitude: 35.2271,
    longitude: -80.8431,
    addressCity: "Charlotte",
    addressState: "NC",
  },
  {
    name: "South End Station",
    orgType: "ao" as const,
    isActive: true,
    regionName: "F3 Charlotte",
    description: "South End AO",
    latitude: 35.2135,
    longitude: -80.8523,
    addressCity: "Charlotte",
    addressState: "NC",
  },
  {
    name: "The Foundry",
    orgType: "ao" as const,
    isActive: true,
    regionName: "F3 Charlotte",
    description: "Steele Creek AO",
    latitude: 35.1852,
    longitude: -80.9301,
    addressCity: "Charlotte",
    addressState: "NC",
  },
];

// ---------------------------------------------------------------------------
// Event types (standard F3 workout types)
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  { name: EventTypes.Bootcamp, eventCategory: "first_f" as const },
  { name: EventTypes.Run, eventCategory: "first_f" as const },
  { name: EventTypes.Ruck, eventCategory: "first_f" as const },
  { name: EventTypes.QSource, eventCategory: "third_f" as const },
  { name: EventTypes.Mobility, eventCategory: "first_f" as const },
];

// ---------------------------------------------------------------------------
// Dev users (fictional, safe to commit)
// ---------------------------------------------------------------------------

const DEV_USERS = [
  {
    email: "dev-admin@f3local.dev",
    f3Name: "Mainframe",
    firstName: "Dev",
    lastName: "Admin",
    emailVerified: new Date().toISOString(),
    role: "admin" as const,
  },
  {
    email: "dev-editor@f3local.dev",
    f3Name: "Patch",
    firstName: "Dev",
    lastName: "Editor",
    emailVerified: new Date().toISOString(),
    role: "editor" as const,
  },
  {
    email: "dev-user@f3local.dev",
    f3Name: "Spotter",
    firstName: "Dev",
    lastName: "User",
    emailVerified: new Date().toISOString(),
    role: null,
  },
];

// ---------------------------------------------------------------------------
// Standard F3 positions seeded per org
// ---------------------------------------------------------------------------

const POSITIONS = [
  {
    name: "Nant'an",
    description:
      "When I looked, all the tags went to a View called Javelin. And tags in there were based on description, not CygNet tag name. And Don said most of the descriptions are the same. Is that not the case? If not, we'll want to let Don know. They want to keep tag names the same in the downstream View because people have displays built off of them and they don't want to have to update them. He did not mention retention time. Sounds like a mess!",
    orgType: "region" as const,
  },
  {
    name: "Site Q",
    description:
      " He plants the flag for the AO, makes folks feel welcome, makes sure the disclaimer is correctly spoken, cadence is called, picks up the 6, makes sure the FNGs have a battle buddy, watches for hydration issues, ETC..",
    orgType: "region" as const,
  },
  {
    name: "ITQ",
    description:
      "Helping streamline operations so guys can get back out into the gloom.",
    orgType: "region" as const,
  },
];

// ---------------------------------------------------------------------------
// API keys (local dev — used by apps/auth to call the API on behalf of users)
// ---------------------------------------------------------------------------

const LOCAL_API_KEYS = [
  {
    key: "local-api-key",
    name: "Auth Service (local dev)",
    description: "Used by apps/auth to register new users via the API",
    role: "editor" as const,
  },
  {
    key: "local-map-key",
    name: "Map App (local dev)",
    description: "Used by apps/map for read-only API access",
    role: "user" as const,
  },
];

// ---------------------------------------------------------------------------
// OAuth clients (local dev — plaintext secret: local-me-client-secret)
// ---------------------------------------------------------------------------

const LOCAL_OAUTH_CLIENTS = [
  {
    id: "f3-me-local",
    name: "F3 Me (local dev)",
    // SHA-256 of "local-me-client-secret" — deterministic so it can be committed
    clientSecretHash:
      "6239f25f8cff37f5ab67b37bfbb9ae94abd1805db915f010573412111a8d54fc",
    redirectUris: JSON.stringify(["http://localhost:3003/api/auth/callback"]),
    allowedOrigin: "http://localhost:3003",
    scopes: "openid profile email",
    isActive: true,
  },
  {
    id: "f3-admin-local",
    name: "F3 Admin (local dev)",
    // SHA-256 of "local-admin-client-secret" — deterministic so it can be committed
    clientSecretHash:
      "47c7916194a344bae65495f8eae734a58ad0f37a28449b8f7d6e14535f4246e6",
    redirectUris: JSON.stringify(["http://localhost:3002/api/auth/callback"]),
    allowedOrigin: "http://localhost:3002",
    scopes: "openid profile email",
    isActive: true,
  },
];

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function seed() {
  console.log("Seeding local development database...");

  // 1. F3 Nation org
  const [existingNation] = await db
    .select()
    .from(schema.orgs)
    .where(
      and(
        eq(schema.orgs.name, NATION.name),
        eq(schema.orgs.orgType, NATION.orgType),
      ),
    );

  let nationId: number;
  if (existingNation) {
    nationId = existingNation.id;
    console.log(`  ✓ F3 Nation org exists (id=${nationId})`);
  } else {
    const [inserted] = await db
      .insert(schema.orgs)
      .values(NATION)
      .returning({ id: schema.orgs.id });
    nationId = inserted!.id;
    console.log(`  + Inserted F3 Nation org (id=${nationId})`);
  }

  // 2. Sectors
  const sectorIds: Record<string, number> = {};
  for (const sector of SECTORS) {
    const [existing] = await db
      .select()
      .from(schema.orgs)
      .where(
        and(
          eq(schema.orgs.name, sector.name),
          eq(schema.orgs.orgType, "sector"),
          eq(schema.orgs.parentId, nationId),
        ),
      );
    if (existing) {
      sectorIds[sector.name] = existing.id;
    } else {
      const [inserted] = await db
        .insert(schema.orgs)
        .values({ ...sector, parentId: nationId })
        .returning({ id: schema.orgs.id });
      sectorIds[sector.name] = inserted!.id;
      console.log(`  + Inserted sector: ${sector.name}`);
    }
  }

  // 3. Areas
  const areaIds: Record<string, number> = {};
  for (const area of AREAS) {
    const sectorId = sectorIds[area.sectorName];
    if (!sectorId) throw new Error(`Sector not found: ${area.sectorName}`);
    const { sectorName: _, ...areaData } = area;
    const [existing] = await db
      .select()
      .from(schema.orgs)
      .where(
        and(
          eq(schema.orgs.name, area.name),
          eq(schema.orgs.orgType, "area"),
          eq(schema.orgs.parentId, sectorId),
        ),
      );
    if (existing) {
      areaIds[area.name] = existing.id;
    } else {
      const [inserted] = await db
        .insert(schema.orgs)
        .values({ ...areaData, parentId: sectorId })
        .returning({ id: schema.orgs.id });
      areaIds[area.name] = inserted!.id;
      console.log(`  + Inserted area: ${area.name}`);
    }
  }

  // 4. Regions
  const regionIds: Record<string, number> = {};
  for (const region of REGIONS) {
    const areaId = areaIds[region.areaName];
    if (!areaId) throw new Error(`Area not found: ${region.areaName}`);
    const { areaName: _, ...regionData } = region;
    const [existing] = await db
      .select()
      .from(schema.orgs)
      .where(
        and(
          eq(schema.orgs.name, region.name),
          eq(schema.orgs.orgType, "region"),
          eq(schema.orgs.parentId, areaId),
        ),
      );
    if (existing) {
      regionIds[region.name] = existing.id;
    } else {
      const [inserted] = await db
        .insert(schema.orgs)
        .values({ ...regionData, parentId: areaId })
        .returning({ id: schema.orgs.id });
      regionIds[region.name] = inserted!.id;
      console.log(`  + Inserted region: ${region.name}`);
    }
  }

  // 5. Event types — loaded here so event seeding in step 6 can reference them
  const existingEventTypes = await db.select().from(schema.eventTypes);
  const existingNames = new Set(existingEventTypes.map((et) => et.name));
  const eventTypesToInsert = EVENT_TYPES.filter(
    (et) => !existingNames.has(et.name),
  );
  if (eventTypesToInsert.length > 0) {
    await db.insert(schema.eventTypes).values(eventTypesToInsert);
    console.log(`  + Inserted ${eventTypesToInsert.length} event type(s)`);
  } else {
    console.log(`  ✓ Event types already seeded`);
  }
  const allEventTypes = await db.select().from(schema.eventTypes);

  // 6. AOs + locations + events
  for (const ao of AOS) {
    const regionId = regionIds[ao.regionName];
    if (!regionId) throw new Error(`Region not found: ${ao.regionName}`);
    const {
      regionName: _,
      latitude,
      longitude,
      addressCity,
      addressState,
      ...aoData
    } = ao;

    let aoId: number;
    const [existingAo] = await db
      .select()
      .from(schema.orgs)
      .where(
        and(
          eq(schema.orgs.name, ao.name),
          eq(schema.orgs.orgType, "ao"),
          eq(schema.orgs.parentId, regionId),
        ),
      );

    if (existingAo) {
      aoId = existingAo.id;
    } else {
      const [insertedAo] = await db
        .insert(schema.orgs)
        .values({ ...aoData, parentId: regionId })
        .returning({ id: schema.orgs.id });
      aoId = insertedAo!.id;
      console.log(`  + Inserted AO: ${ao.name}`);
    }

    // Create a location for the AO if one doesn't exist
    const [existingLoc] = await db
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.name, ao.name),
          eq(schema.locations.orgId, regionId),
        ),
      );

    let locationId: number | undefined;
    if (!existingLoc) {
      const [insertedLoc] = await db
        .insert(schema.locations)
        .values({
          orgId: regionId,
          name: ao.name,
          isActive: true,
          latitude,
          longitude,
          addressCity,
          addressState,
          addressCountry: "US",
        })
        .returning({ id: schema.locations.id });
      locationId = insertedLoc?.id;
      console.log(`  + Inserted location for AO: ${ao.name}`);
    } else {
      locationId = existingLoc.id;
    }
    // Create a weekly Bootcamp event for the AO if none exists
    if (locationId) {
      const [existingEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.orgId, aoId));

      if (!existingEvent) {
        const [insertedEvent] = await db
          .insert(schema.events)
          .values({
            orgId: aoId,
            locationId,
            isActive: true,
            highlight: false,
            startDate: "2025-01-06",
            startTime: "05:30",
            endTime: "06:15",
            name: `${ao.name} Bootcamp`,
            dayOfWeek: "monday",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
          })
          .returning({ id: schema.events.id });

        if (insertedEvent) {
          // Link to Bootcamp event type
          const bootcampType = allEventTypes.find(
            (et) => et.name === "Bootcamp",
          );
          if (bootcampType) {
            await db
              .insert(schema.eventsXEventTypes)
              .values({
                eventId: insertedEvent.id,
                eventTypeId: bootcampType.id,
              })
              .onConflictDoNothing();
          }
          console.log(`  + Inserted event for AO: ${ao.name}`);
        }
      }
    }
  }

  // 7. Roles
  const existingRoles = await db.select().from(schema.roles);
  const rolesToInsert = RegionRole.filter(
    (r) => !existingRoles.some((e) => e.name === r),
  );
  if (rolesToInsert.length > 0) {
    await db
      .insert(schema.roles)
      .values(rolesToInsert.map((r) => ({ name: r })))
      .onConflictDoNothing();
    console.log(`  + Inserted roles: ${rolesToInsert.join(", ")}`);
  }
  const allRoles = await db.select().from(schema.roles);
  const adminRole = allRoles.find((r) => r.name === "admin");
  const editorRole = allRoles.find((r) => r.name === "editor");
  const userRole = allRoles.find((r) => r.name === "user");
  if (!adminRole || !editorRole || !userRole)
    throw new Error("Roles missing after insert");

  // 8. Dev users
  let adminUserId: number | undefined;
  for (const devUser of DEV_USERS) {
    const { role, ...userData } = devUser;
    await db.insert(schema.users).values(userData).onConflictDoNothing();

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, devUser.email));
    if (!user) continue;

    if (role === "admin") adminUserId = user.id;

    const roleId =
      role === "admin"
        ? adminRole.id
        : role === "editor"
          ? editorRole.id
          : null;
    if (roleId !== null) {
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ userId: user.id, roleId, orgId: nationId })
        .onConflictDoNothing();
    }
    console.log(`  ✓ Dev user: ${devUser.email} (${role})`);
  }

  // 9. API keys
  if (!adminUserId) throw new Error("Admin dev user missing after insert");
  for (const apiKey of LOCAL_API_KEYS) {
    const [inserted] = await db
      .insert(schema.apiKeys)
      .values({ ...apiKey, ownerId: adminUserId })
      .onConflictDoNothing()
      .returning({ id: schema.apiKeys.id });

    // Look up the key id (either just inserted, or already exists)
    const keyId =
      inserted?.id ??
      (
        await db
          .select({ id: schema.apiKeys.id })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.key, apiKey.key))
          .limit(1)
      )[0]?.id;

    if (keyId) {
      const roleId = apiKey.role === "editor" ? editorRole.id : userRole.id;
      await db
        .insert(schema.rolesXApiKeysXOrg)
        .values({ apiKeyId: keyId, roleId, orgId: nationId })
        .onConflictDoNothing();
    }
    console.log(`  ✓ API key: ${apiKey.key}`);
  }

  // 10. OAuth clients
  for (const client of LOCAL_OAUTH_CLIENTS) {
    await db
      .insert(authSchema.oauthClients)
      .values(client)
      .onConflictDoNothing();
    console.log(`  ✓ OAuth client: ${client.id}`);
  }

  // 11. Positions — standard F3 positions seeded per region
  for (const region of REGIONS) {
    const regionId = regionIds[region.name];
    if (!regionId) continue;
    for (const position of POSITIONS) {
      const [existing] = await db
        .select()
        .from(schema.positions)
        .where(
          and(
            eq(schema.positions.name, position.name),
            eq(schema.positions.orgId, regionId),
          ),
        );
      if (!existing) {
        await db.insert(schema.positions).values({
          name: position.name,
          description: position.description,
          orgId: regionId,
          orgType: "region",
          isActive: true,
        });
        console.log(
          `  + Inserted position "${position.name}" for ${region.name}`,
        );
      }
    }
  }

  // 12. Reset sequences so auto-increment IDs don't collide with inserted rows
  await resetSequences();

  console.log("\nLocal seed complete.");
  console.log(
    "  Log in with: dev-admin@f3local.dev, dev-editor@f3local.dev, or dev-user@f3local.dev",
  );
}

async function resetSequences() {
  const [maxOrgId] = await db
    .select({ max: sql<number>`max(${schema.orgs.id})` })
    .from(schema.orgs);
  const [maxLocationId] = await db
    .select({ max: sql<number>`max(${schema.locations.id})` })
    .from(schema.locations);
  const [maxEventId] = await db
    .select({ max: sql<number>`coalesce(max(${schema.events.id}), 0)` })
    .from(schema.events);

  if (maxOrgId?.max) {
    await db.execute(sql`SELECT setval('orgs_id_seq', ${maxOrgId.max + 1})`);
  }
  if (maxLocationId?.max) {
    await db.execute(
      sql`SELECT setval('locations_id_seq', ${maxLocationId.max + 1})`,
    );
  }
  if (maxEventId?.max !== undefined && maxEventId.max > 0) {
    await db.execute(
      sql`SELECT setval('events_id_seq', ${maxEventId.max + 1})`,
    );
  }

  const [maxApiKeyId] = await db
    .select({ max: sql<number>`coalesce(max(${schema.apiKeys.id}), 0)` })
    .from(schema.apiKeys);
  if (maxApiKeyId?.max !== undefined && maxApiKeyId.max > 0) {
    await db.execute(
      sql`SELECT setval('api_keys_id_seq', ${maxApiKeyId.max + 1})`,
    );
  }
}

void seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
