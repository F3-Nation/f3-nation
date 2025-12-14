import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

import { and, eq, inArray, or, sql } from "@acme/db";
import { env } from "@acme/env";
import { EventTags, RegionRole } from "@acme/shared/app/enums";
import { safeParseFloat } from "@acme/shared/common/functions";

import type { InferInsertModel } from ".";
import type { AppDb } from "./client";
import { schema } from ".";
import { db } from "./client";
import { getDb } from "./utils/functions";

// import { getLocationDataFromGravityForms } from "./utils/get-location-data-gravity-forms";

const _EVENT_TAGS = [
  { name: EventTags.Open, color: "Green" },
  { name: EventTags.VQ, color: "Blue" },
  { name: EventTags.Manniversary, color: "Yellow" },
  { name: EventTags.Convergence, color: "Orange" },
];

const _GRAVITY_FORMS_TIME_FORMAT = "hh:mm a" as const;
dayjs.extend(customParseFormat);

if (!("DATABASE_URL" in env))
  throw new Error("DATABASE_URL not found on .env.development");

const _reseedUsers = async () => {
  await db.delete(schema.authAccounts);
  await db.delete(schema.authSessions);
  await db.delete(schema.authVerificationTokens);
  await db.delete(schema.users);
  await db.delete(schema.updateRequests);
  await insertUsers();
};

const _reseedFromScratch = async () => {
  // const { regionData, workoutData } = await getLocationDataFromGravityForms();
  SEED_LOGS && console.log("Seed start", env.DATABASE_URL);

  await db.delete(schema.attendance);
  await db.delete(schema.attendanceTypes);
  await db.delete(schema.eventTags);
  await db.delete(schema.eventTypes);
  await db.delete(schema.eventsXEventTypes);
  await db.delete(schema.locations);
  await db.delete(schema.orgs);
  await db.delete(schema.permissions);
  await db.delete(schema.roles);
  await db.delete(schema.rolesXPermissions);
  await db.delete(schema.events);
  await db.delete(schema.slackUsers);

  await db.delete(schema.authAccounts);
  await db.delete(schema.authSessions);
  await db.delete(schema.authVerificationTokens);
  await db.delete(schema.users);
  await db.delete(schema.updateRequests);

  SEED_LOGS && console.log("Inserting data");
  // await insertData({ regionData, workoutData });

  await insertUsers();

  SEED_LOGS && console.log("Seed done");
};
const _deleteSeededData = async () => {
  // await db.execute(sql`SET session_replication_role = 'replica';`);
  try {
    console.log("deleting data");

    console.log("getting seeded orgs");
    const seededOrgsDirect = await db
      .select()
      .from(schema.orgs)
      .where(sql`${schema.orgs.meta}->>'mapSeed' = 'true'`);

    const seededOrgsByParentId = await db
      .select()
      .from(schema.orgs)
      .where(
        inArray(
          schema.orgs.parentId,
          seededOrgsDirect.map((o) => o.id),
        ),
      );
    const seededOrgs = [...seededOrgsDirect, ...seededOrgsByParentId];
    console.log("seeded orgs", seededOrgs.length);

    console.log("getting seeded locations");
    const seededLocations = await db
      .select()
      .from(schema.locations)
      .where(
        or(
          sql`${schema.locations.meta}->>'mapSeed' = 'true'`,
          inArray(
            schema.locations.orgId,
            seededOrgs.map((l) => l.id),
          ),
        ),
      );
    console.log("seeded locations", seededLocations.length);

    console.log("getting map seed events");
    const seededEvents = await db
      .select()
      .from(schema.events)
      .where(
        or(
          sql`${schema.events.meta}->>'mapSeed' = 'true'`,
          inArray(
            schema.events.orgId,
            seededOrgs.map((l) => l.id),
          ),
          inArray(
            schema.events.locationId,
            seededLocations.map((l) => l.id),
          ),
        ),
      );
    console.log("map seed events", seededEvents.length);

    console.log("Getting map event instances");
    const seededEventInstances = await db
      .select()
      .from(schema.eventInstances)
      .where(
        inArray(
          schema.eventInstances.seriesId,
          seededEvents.map((e) => e.id),
        ),
      );
    console.log("map event instances", seededEventInstances.length);

    console.log("Getting map event instance event types");
    const seededEventInstanceEventTypes = await db
      .select()
      .from(schema.eventInstancesXEventTypes)
      .where(
        inArray(
          schema.eventInstancesXEventTypes.eventInstanceId,
          seededEventInstances.map((e) => e.id),
        ),
      );
    console.log(
      "map event instance event types",
      seededEventInstanceEventTypes.length,
    );

    console.log("deleting event instance event types");
    await db.delete(schema.eventInstancesXEventTypes).where(
      inArray(
        schema.eventInstancesXEventTypes.eventInstanceId,
        seededEventInstances.map((e) => e.id),
      ),
    );
    console.log("deleted event instance event types");

    console.log("deleting event instances");
    await db.delete(schema.eventInstances).where(
      inArray(
        schema.eventInstances.id,
        seededEventInstances.map((e) => e.id),
      ),
    );
    console.log("deleted event instances");
    console.log("deleting update requests");
    await db.delete(schema.updateRequests);

    console.log("deleting event types");
    await db.delete(schema.eventsXEventTypes).where(
      inArray(
        schema.eventsXEventTypes.eventId,
        seededEvents.map((e) => e.id),
      ),
    );
    console.log("deleted event types");

    console.log("deleting events");
    await db.delete(schema.events).where(
      inArray(
        schema.events.id,
        seededEvents.map((e) => e.id),
      ),
    );
    console.log("deleted events");

    console.log("deleting locations");
    await db.delete(schema.locations).where(
      inArray(
        schema.locations.id,
        seededLocations.map((l) => l.id),
      ),
    );
    console.log("deleted locations");

    console.log("deleting rolesXUsersXOrg");
    await db.delete(schema.rolesXUsersXOrg).where(
      inArray(
        schema.rolesXUsersXOrg.orgId,
        seededOrgs.map((o) => o.id),
      ),
    );
    console.log("deleted rolesXUsersXOrg");

    console.log("deleting orgs");
    await db.delete(schema.orgs).where(
      inArray(
        schema.orgs.id,
        seededOrgs.map((o) => o.id),
      ),
    );
    console.log("deleted orgs");

    console.log("inserting data");
  } finally {
    // await db.execute(sql`SET session_replication_role = 'origin';`);
  }
};

// const _reseedJustData = async () => {
//   const { regionData, workoutData } = await getLocationDataFromGravityForms();
//   await insertData({ regionData, workoutData });
//   await insertUsers();
// };

export const seed = async (db?: AppDb) => {
  const _db = db ?? getDb();

  // await insertUsers();
  // await _reseedFromScratch();
  // await _deleteSeededData()
  // await _reseedJustData();
  // await _reseedUsers();
  // await insertRandomUsers();
  await _resetSequences();
};

const SEED_LOGS = false;

export async function insertUsers() {
  const usersToInsert: InferInsertModel<typeof schema.users>[] = [
    {
      email: "declan@mountaindev.com",
      f3Name: "Spuds",
      firstName: "Declan",
      lastName: "Nishiyama",
      emailVerified: dayjs().format(),
    },
    {
      email: "patrick@pstaylor.net",
      f3Name: "Baguette",
      firstName: "Patrick",
      lastName: "Taylor",
      emailVerified: dayjs().format(),
    },
    {
      email: "jimsheldon@icloud.com",
      f3Name: "Sumo",
      firstName: "Jim",
      lastName: "Sheldon",
      emailVerified: dayjs().format(),
    },
    {
      email: "damon.vinciguerra@gmail.com",
      f3Name: "Tackle",
      firstName: "Damon",
      lastName: "Vinciguerra",
      emailVerified: dayjs().format(),
    },
    {
      email: "taylor.matt777@gmail.com",
      f3Name: "Backslash",
      firstName: "Matt",
      lastName: "Taylor",
      emailVerified: dayjs().format(),
    },
    {
      email: "pjarchambeault@gmail.com",
      f3Name: "DOS",
      firstName: "PJ",
      lastName: "Archambeault",
      emailVerified: dayjs().format(),
    },
    {
      email: "johnanthonyreynolds@gmail.com",
      f3Name: "Snooki",
      firstName: "John",
      lastName: "Reynolds",
      emailVerified: dayjs().format(),
    },
    {
      email: "evan.petzoldt@protonmail.com",
      f3Name: "Moneyball",
      firstName: "Evan",
      lastName: "Petzoldt",
      emailVerified: dayjs().format(),
    },
  ];

  await db.insert(schema.users).values(usersToInsert).onConflictDoNothing();

  const users = await db.select().from(schema.users);
  console.log("users", users.length);

  // const _permissions = await db
  //   .insert(schema.permissions)
  //   .values(
  //     Object.values(PERMISSIONS).map((p) => ({
  //       id: p.id,
  //       name: p.name,
  //       description: p.description,
  //     })),
  //   )
  //   .returning();
  const existingRoles = await db.select().from(schema.roles);
  const rolesToInsert = RegionRole.filter(
    (r) => !existingRoles.some((existingRole) => existingRole.name === r),
  );

  if (rolesToInsert.length > 0) {
    await db
      .insert(schema.roles)
      .values(rolesToInsert.map((r) => ({ name: r })))
      .onConflictDoNothing();
  }

  const roles = await db.select().from(schema.roles);

  const editorRegionRole = roles.find((r) => r.name === "editor");
  const adminRegionRole = roles.find((r) => r.name === "admin");
  if (!editorRegionRole) throw new Error("Editor region role not found");
  if (!adminRegionRole) throw new Error("Admin region role not found");

  const [f3nation] = await db
    .select()
    .from(schema.orgs)
    .where(
      and(eq(schema.orgs.name, "F3 Nation"), eq(schema.orgs.orgType, "nation")),
    );
  if (!f3nation) throw new Error("F3 Nation not found");
  const regions = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "region"));

  const boone = regions.find((r) => r.name === "Boone");
  if (!boone) throw new Error("Boone not found");

  const user1 = users.find((u) => u.email === "declan@mountaindev.com");
  if (!user1) throw new Error("Declan not found");
  const user2 = users.find((u) => u.email === "patrick@pstaylor.net");
  if (!user2) throw new Error("Patrick not found");
  const user3 = users.find((u) => u.email === "jimsheldon@icloud.com");
  if (!user3) throw new Error("Jim not found");
  const user4 = users.find((u) => u.email === "damon.vinciguerra@gmail.com");
  if (!user4) throw new Error("Damon not found");
  const user5 = users.find((u) => u.email === "taylor.matt777@gmail.com");
  if (!user5) throw new Error("Matt not found");
  const user6 = users.find((u) => u.email === "pjarchambeault@gmail.com");
  if (!user6) throw new Error("PJ not found");
  const user7 = users.find((u) => u.email === "johnanthonyreynolds@gmail.com");
  if (!user7) throw new Error("John not found");
  const user8 = users.find((u) => u.email === "evan.petzoldt@protonmail.com");
  if (!user8) throw new Error("Evan not found");

  const rolesXUsersXOrg: InferInsertModel<typeof schema.rolesXUsersXOrg>[] = [
    {
      userId: user1.id,
      roleId: adminRegionRole.id,
      orgId: f3nation.id,
    },
    {
      userId: user2.id,
      roleId: adminRegionRole.id,
      orgId: f3nation.id,
    },
    {
      userId: user3.id,
      roleId: adminRegionRole.id,
      orgId: f3nation.id,
    },
    {
      userId: user4.id,
      roleId: adminRegionRole.id,
      orgId: f3nation.id,
    },
    {
      userId: user7.id,
      roleId: adminRegionRole.id,
      orgId: f3nation.id,
    },
    {
      userId: user8.id,
      roleId: adminRegionRole.id,
      orgId: f3nation.id,
    },
  ];

  await db
    .insert(schema.rolesXUsersXOrg)
    .values(rolesXUsersXOrg)
    .onConflictDoNothing();
}

export async function insertDatabaseStructure(
  _workoutData?: WorkoutSheetData[],
) {
  console.log("inserting event types");
  await db
    .insert(schema.eventTypes)
    .values([
      {
        name: EventTypes.Bootcamp,
        acronym: "BC",
        eventCategory: "first_f",
      },
      {
        name: EventTypes.Run,
        acronym: "RU",
        eventCategory: "first_f",
      },
      {
        name: EventTypes.Ruck,
        acronym: "RK",
        eventCategory: "first_f",
      },
      {
        name: EventTypes.QSource,
        acronym: "QS",
        eventCategory: "third_f",
      },
      {
        name: EventTypes.Swimming,
        acronym: "SW",
        eventCategory: "first_f",
      },

      {
        name: EventTypes.Mobility,
        acronym: "MB",
        eventCategory: "first_f",
      },
      {
        name: EventTypes.Bike,
        acronym: "BK",
        eventCategory: "first_f",
      },

      {
        name: EventTypes.Gear,
        acronym: "GR",
        eventCategory: "first_f",
      },
      {
        name: EventTypes["Wild Card"],
        acronym: "WC",
        eventCategory: "first_f",
      },
      {
        name: EventTypes.Sports,
        acronym: "SP",
        eventCategory: "first_f",
      },
    ])
    .onConflictDoUpdate({
      target: [schema.eventTypes.id],
      set: {
        name: sql`excluded.name`,
        acronym: sql`excluded.acronym`,
        eventCategory: sql`excluded.event_category`,
      },
    });

  const eventTypes = await db.select().from(schema.eventTypes);

  const existingEventTags = await db.select().from(schema.eventTags);
  const eventTagsToInsert = EVENT_TAGS.filter(
    (t) =>
      !existingEventTags.some(
        (existingTag) => existingTag.name === t.name.toString(),
      ),
  );

  if (eventTagsToInsert.length > 0) {
    await db.insert(schema.eventTags).values(eventTagsToInsert);
  }

  const eventTags = await db.select().from(schema.eventTags);

  return { eventTypes, eventTags };
}

export async function insertData(data: {
  workoutData: WorkoutSheetData[];
  regionData: RegionSheetData[];
}) {
  const allOrgParentIds = (
    await db.select({ parentId: schema.orgs.parentId }).from(schema.orgs)
  )
    .map((o) => o.parentId)
    .filter(isTruthy);

  const { eventTypes } = await insertDatabaseStructure(data.workoutData);
  const insertedNation = await db
    .insert(schema.orgs)
    .values({
      name: "F3 Nation",
      isActive: true,
      orgType: "nation",
    })
    .onConflictDoUpdate({
      target: [schema.orgs.id],
      set: {
        name: sql`excluded.name`,
        isActive: sql`excluded.is_active`,
        orgType: sql`excluded.org_type`,
      },
    })
    .returning({ id: schema.orgs.id });

  await db.execute(
    sql`SELECT setval(pg_get_serial_sequence('orgs', 'id'), COALESCE((SELECT MAX(id) FROM orgs), 0) + 1, false)`,
  );

  const { workoutData, regionData } = data;

  // Clean up sectors
  const deletedSectors = await db
    .delete(schema.orgs)
    .where(
      and(
        eq(schema.orgs.orgType, "sector"),
        notInArray(schema.orgs.id, allOrgParentIds),
      ),
    );
  console.log("deleted sectors", deletedSectors.length);

  const existingSectors = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "sector"));

  const sectorsToInsert = regionData
    .map((d) =>
      d.Sector
        ? {
            name: d.Sector,
            id: existingSectors.find((s) => s.name === d.Sector)?.id,
          }
        : null,
    )
    .filter(isTruthy)
    .filter((d, idx, arr) => arr.findIndex((d2) => d2.name === d.name) === idx);

  console.log("inserting sectors", sectorsToInsert.length);
  const insertedSectors = await db
    .insert(schema.orgs)
    .values(
      sectorsToInsert.map((d) => ({
        name: d.name,
        id: d.id,
        isActive: true,
        orgType: "sector" as const,
        parentId: insertedNation[0]?.id,
        meta: { mapSeed: true },
      })),
    )
    .onConflictDoUpdate({
      target: [schema.orgs.id],
      set: {
        name: sql`excluded.name`,
        isActive: sql`excluded.is_active`,
        orgType: sql`excluded.org_type`,
        parentId: sql`excluded.parent_id`,
        meta: sql`excluded.meta`,
      },
    })
    .returning();

  console.log(
    "inserted sectors",
    insertedSectors.map((s) => s.id),
  );

  const sectorNameToId = insertedSectors.reduce(
    (acc, d) => {
      acc[d.name] = d.id;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Clean up areas
  const deletedAreas = await db
    .delete(schema.orgs)
    .where(
      and(
        eq(schema.orgs.orgType, "area"),
        notInArray(schema.orgs.id, allOrgParentIds),
      ),
    );
  console.log("deleted areas", deletedAreas.length);

  const existingAreas = await db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "area"));

  const areasToInsert = regionData
    .map((d) => {
      const sectorId = sectorNameToId[d.Sector];
      if (sectorId === undefined || !d.Area) return null;
      return {
        name: d.Area,
        sectorId,
        id: existingAreas.find((a) => a.name === d.Area)?.id,
      };
    })
    .filter(isTruthy)
    .filter(
      (d, idx, arr) =>
        d.name !== "" &&
        d.sectorId !== undefined &&
        arr.findIndex((d2) => d2.name === d.name) === idx,
    );

  console.log("inserting areas", areasToInsert.length);
  const insertedAreas = await db
    .insert(schema.orgs)
    .values(
      areasToInsert.map((d) => ({
        id: d.id,
        name: d.name,
        isActive: true,
        orgType: "area" as const,
        parentId: d.sectorId,
        meta: { mapSeed: true },
      })),
    )
    .onConflictDoUpdate({
      target: [schema.orgs.id],
      set: {
        name: sql`excluded.name`,
        isActive: sql`excluded.is_active`,
        orgType: sql`excluded.org_type`,
        parentId: sql`excluded.parent_id`,
        meta: sql`excluded.meta`,
      },
    })
    .returning();
  console.log(
    "inserted areas",
    insertedAreas.map((a) => a.id),
  );

  const areaNameToId = insertedAreas.reduce(
    (acc, d) => {
      acc[d.name] = d.id;
      return acc;
    },
    {} as Record<string, number>,
  );

  const regionDataToInsert = regionData
    .map((region) => {
      if (!region["Region Name"].replace("-", "").trim()) return null;
      const areaId = areaNameToId[region.Area];
      if (areaId === undefined) return null;
      const regionData: InferInsertModel<typeof schema.orgs> = {
        id: safeParseInt(region["Entry ID"]),
        name: region["Region Name"] ?? "",
        isActive: true,
        orgType: "region" as const,
        website:
          region.Website.includes("f3nation.com") ||
          region.Website.includes(".slack.com")
            ? undefined
            : region.Website,
        email: region["Region Email"],
        description: undefined, // NOTE: currently no region descriptions
        parentId: areaId,
        created: dayjs(region.Created).format(),
        updated: dayjs(region.Updated).format(),
        meta: { mapSeed: true },
      };
      return regionData;
    })
    .filter(isTruthy);

  console.log("inserting regions", regionData.length);
  const regions = await db
    .insert(schema.orgs)
    .values(regionDataToInsert)
    .onConflictDoUpdate({
      target: [schema.orgs.id],
      set: {
        name: sql`excluded.name`,
        isActive: sql`excluded.is_active`,
        orgType: sql`excluded.org_type`,
        parentId: sql`excluded.parent_id`,
        meta: sql`excluded.meta`,
        created: sql`excluded.created`,
        updated: sql`excluded.updated`,
        website: sql`excluded.website`,
        email: sql`excluded.email`,
        description: sql`excluded.description`,
      },
    })
    .returning({ id: schema.orgs.id, name: schema.orgs.name });

  console.log("inserted regions", regions.length);

  const uniqueAOsWithWorkouts = workoutData.reduce(
    (acc, workout) => {
      const workoutRegionId = regions.find(
        (region) => region.name === workout.Region,
      )?.id;
      const latLonKey = getLatLonKey({
        latitude: workout.Latitude,
        longitude: workout.Longitude,
      });
      if (workoutRegionId === undefined || latLonKey === undefined) return acc;
      if (!acc[latLonKey]) {
        acc[latLonKey] = {
          ao: {
            id: safeParseInt(workout["Entry ID"]),
            regionId: workoutRegionId,
            latitude: workout.Latitude,
            longitude: workout.Longitude,
            key: latLonKey,
          },
          events: [],
        };
      }
      acc[latLonKey]?.events.push(workout);
      return acc;
    },
    {} as Record<
      string,
      {
        ao: {
          id: number | undefined;
          regionId: number;
          latitude: string | undefined;
          longitude: string | undefined;
          key: string;
        };
        events: WorkoutSheetData[];
      }
    >,
  );

  const aoOrgData = Object.values(uniqueAOsWithWorkouts).map(
    ({ ao, events }) => {
      const created = events
        .reduce(
          (acc, e) => (dayjs(e.Created).isBefore(acc) ? dayjs(e.Created) : acc),
          dayjs(),
        )
        .format();
      const updated = events
        .reduce(
          (acc, e) => (dayjs(e.Updated).isAfter(acc) ? dayjs(e.Updated) : acc),
          dayjs(0),
        )
        .format();

      const aoData: InferInsertModel<typeof schema.orgs> = {
        // name: "", // AOs do not have names yet
        id: ao.id,
        name: events
          .map((e) => e["Workout Name"])
          .filter(onlyUnique)
          .join(", "),
        isActive: true,
        orgType: "ao" as const,
        logoUrl: events[0]?.Logo,
        parentId: ao.regionId,
        description: undefined,
        website: events[0]?.Website,
        meta: {
          latLonKey: ao.key,
          address1: events[0]?.["Address 1"],
          address2: events[0]?.["Address 2"],
          city: events[0]?.City,
          state: events[0]?.State,
          postalCode: events[0]?.["Postal Code"],
          country:
            events[0]?.Country.toLowerCase() === "united states"
              ? "United States"
              : events[0]?.Country,
          mapSeed: true,
        },
        created: dayjs(created).format(),
        updated: dayjs(updated).format(),
      };
      return aoData;
    },
  );

  const aoOrgs = await db
    .insert(schema.orgs)
    .values(aoOrgData)
    .onConflictDoUpdate({
      target: [schema.orgs.id],
      set: {
        name: sql`excluded.name`,
        isActive: sql`excluded.is_active`,
        orgType: sql`excluded.org_type`,
        parentId: sql`excluded.parent_id`,
        meta: sql`excluded.meta`,
        created: sql`excluded.created`,
        updated: sql`excluded.updated`,
        logoUrl: sql`excluded.logo_url`,
        description: sql`excluded.description`,
        website: sql`excluded.website`,
      },
    })
    .returning();

  console.log("inserted ao orgs", aoOrgs.length);

  const aoOrgKeyDict = aoOrgs.reduce(
    (acc, aoOrg) => {
      const latLonKey = (aoOrg.meta as { latLonKey?: string | undefined })
        ?.latLonKey;
      if (!latLonKey) return acc;
      acc[latLonKey] = aoOrg;
      return acc;
    },
    {} as Record<
      string,
      { id: number; description: string | null; name: string }
    >,
  );

  const aoLocsData = Object.values(uniqueAOsWithWorkouts).map(
    ({ ao, events }) => {
      const aoRegion = regions.find((r) => r.id === ao.regionId);
      if (aoRegion == undefined) throw new Error("AO region not found");
      const aoOrg = aoOrgKeyDict[ao.key];
      if (aoOrg == undefined) throw new Error("AO org not found");
      if (!isNumber(aoOrg.id)) throw new Error("AO org id is not a number");
      const locationData: InferInsertModel<typeof schema.locations> = {
        id: aoOrg.id,
        name: aoOrg.name,
        isActive: true,
        addressStreet: events[0]?.["Address 1"],
        addressStreet2: events[0]?.["Address 2"],
        addressCity: events[0]?.City,
        addressState: events[0]?.State,
        addressZip: events[0]?.["Postal Code"],
        addressCountry: events[0]?.Country,
        description: aoOrg?.description, // AOs description is the address
        latitude: safeParseFloat(ao.latitude),
        longitude: safeParseFloat(ao.longitude),
        orgId: aoRegion.id,
        meta: {
          latLonKey: ao.key,
          address1: events[0]?.["Address 1"],
          address2: events[0]?.["Address 2"],
          city: events[0]?.City,
          state: events[0]?.State,
          postalCode: events[0]?.["Postal Code"],
          country: events[0]?.Country,
          mapSeed: true,
        },
      };
      return locationData;
    },
  );

  const aoLocs = await db
    .insert(schema.locations)
    .values(aoLocsData)
    .onConflictDoUpdate({
      target: [schema.locations.id],
      set: {
        name: sql`excluded.name`,
        isActive: sql`excluded.is_active`,
        addressStreet: sql`excluded.address_street`,
        addressStreet2: sql`excluded.address_street2`,
        addressCity: sql`excluded.address_city`,
        addressState: sql`excluded.address_state`,
        addressZip: sql`excluded.address_zip`,
        addressCountry: sql`excluded.address_country`,
        description: sql`excluded.description`,
        latitude: sql`excluded.latitude`,
        longitude: sql`excluded.longitude`,
        meta: sql`excluded.meta`,
        created: sql`excluded.created`,
        updated: sql`excluded.updated`,
        orgId: sql`excluded.org_id`,
      },
    })
    .returning();

  console.log("inserted locations", aoLocs.length);

  const eventsToInsert: InferInsertModel<typeof schema.events>[] =
    Object.values(uniqueAOsWithWorkouts).flatMap(({ ao, events }) => {
      const aoOrg = aoOrgKeyDict[ao.key];
      const orgId = aoOrg?.id;
      if (orgId == undefined) throw new Error("AO org id not found");
      return events.map((workout) => {
        const id = safeParseInt(workout["Entry ID"]);
        const dayOfWeek = DayOfWeek.includes(
          workout.Weekday.toLowerCase() as DayOfWeek,
        )
          ? (workout.Weekday.toLowerCase() as DayOfWeek)
          : null;
        const workoutAoLoc = aoLocs.find(
          (aoItem) =>
            ao.key ===
            getLatLonKey({
              latitude: aoItem.latitude,
              longitude: aoItem.longitude,
            }),
        );

        const [startTimeRaw, endTimeRaw] = workout.Time.split("-").map((time) =>
          time.trim(),
        );
        const startTime = startTimeRaw
          ? dayjs(startTimeRaw.toLowerCase(), GRAVITY_FORMS_TIME_FORMAT)
          : undefined;
        const endTime = endTimeRaw
          ? dayjs(endTimeRaw.toLowerCase(), GRAVITY_FORMS_TIME_FORMAT)
          : undefined;

        const eventTypeId = eventTypes.find((et) => {
          const eventType = getCleanedEventType(workout.Type);
          return et.name === eventType;
        })?.id;
        if (eventTypeId === undefined)
          throw new Error(
            `Event type id is undefined for event ${workout.Type}, ${getCleanedEventType(workout.Type)}`,
          );
        const workoutItem: InferInsertModel<typeof schema.events> = {
          id,
          locationId: workoutAoLoc?.id, // locationIdDict[workout.Location],
          isActive: true,
          highlight: false,
          startDate:
            workout.Created === "0000-00-00 00:00:00"
              ? "2021-01-01"
              : workout.Created,
          dayOfWeek,
          startTime: startTime?.isValid() ? startTime.format("HHmm") : null,
          endTime: endTime?.isValid() ? endTime.format("HHmm") : null,
          name: workout["Workout Name"].slice(0, 100),
          meta: { eventTypeId, mapSeed: true },
          description: workout.Note,
          recurrencePattern: "weekly",
          orgId,
        };
        return workoutItem;
      });
    });

  console.log("events to insert:", eventsToInsert.length);

  const chunkSize = 1000;
  for (let i = 0; i < eventsToInsert.length; i += chunkSize) {
    const eventsChunk = eventsToInsert.slice(i, i + chunkSize);
    await db
      .insert(schema.events)
      .values(eventsChunk)
      .onConflictDoUpdate({
        target: [schema.events.id],
        set: {
          locationId: sql`excluded.location_id`,
          isActive: sql`excluded.is_active`,
          highlight: sql`excluded.highlight`,
          startDate: sql`excluded.start_date`,
          dayOfWeek: sql`excluded.day_of_week`,
          startTime: sql`excluded.start_time`,
          endTime: sql`excluded.end_time`,
          name: sql`excluded.name`,
          meta: sql`excluded.meta`,
          description: sql`excluded.description`,
          recurrencePattern: sql`excluded.recurrence_pattern`,
          orgId: sql`excluded.org_id`,
          created: sql`excluded.created`,
          updated: sql`excluded.updated`,
        },
      })
      .returning();
    console.log("inserted events", i + eventsChunk.length);
  }

  const insertedEvents = await db.select().from(schema.events);

  await db
    .insert(schema.eventsXEventTypes)
    .values(
      insertedEvents
        .map((e) => {
          return e.meta?.eventTypeId
            ? {
                eventId: e.id,
                eventTypeId: e.meta?.eventTypeId,
                meta: { mapSeed: true },
              }
            : null;
        })
        .filter(isTruthy),
    )
    .onConflictDoNothing()
    .returning();
}

const getLatLonKey = ({
  latitude,
  longitude,
}: {
  latitude: number | string | null;
  longitude: number | string | null;
}) => {
  const latNum =
    typeof latitude === "number" ? latitude : safeParseFloat(latitude);
  const lonNum =
    typeof longitude === "number" ? longitude : safeParseFloat(longitude);
  const latStr = latNum?.toFixed(3); // 4 digits is 11m
  const lonStr = lonNum?.toFixed(3); // 4 digits is 11m
  if (latStr === undefined || lonStr === undefined) {
    return undefined;
  }
  return `${latStr},${lonStr}`;
};

const _getCleanedEventType = (eventTypeRaw: string) => {
  if (eventTypeRaw === "Cycling") return "Bike";
  if (
    eventTypeRaw === "Strength/Conditioning/Tabata/WIB" ||
    eventTypeRaw === "CORE"
  )
    return "Bootcamp";
  if (eventTypeRaw === "Obstacle Training" || eventTypeRaw === "Sandbag")
    return "Gear";
  if (eventTypeRaw === "Mobility/Stretch") return "Mobility";
  if (
    eventTypeRaw === "Run with Pain Stations" ||
    eventTypeRaw === "Speed/Strength Running"
  )
    return "Run";
  return eventTypeRaw;
};

const withTriggerManagement = async (db: AppDb, fn: () => Promise<void>) => {
  await db.execute(sql`SELECT toggle_ao_count_trigger(TRUE)`);
  await fn();
  await db.execute(sql`SELECT toggle_ao_count_trigger(FALSE)`);

  // Run a one-time recalculation of all counts
  await db.execute(sql`
  -- Update regions
  UPDATE orgs region
  SET ao_count = (
    SELECT COUNT(*)
    FROM orgs ao
    WHERE ao.parent_id = region.id
      AND ao.org_type = 'ao'
      AND ao.is_active = true
  )
  WHERE region.org_type = 'region';

  -- Update areas
  UPDATE orgs area
  SET ao_count = (
    SELECT COUNT(*)
    FROM orgs ao
    JOIN orgs region ON ao.parent_id = region.id
    WHERE region.parent_id = area.id
      AND ao.org_type = 'ao'
      AND region.org_type = 'region'
      AND ao.is_active = true
      AND region.is_active = true
  )
  WHERE area.org_type = 'area';

  -- Update sectors
  UPDATE orgs sector
  SET ao_count = (
    SELECT COUNT(*)
    FROM orgs ao
    JOIN orgs region ON ao.parent_id = region.id
    JOIN orgs area ON region.parent_id = area.id
    WHERE area.parent_id = sector.id
      AND ao.org_type = 'ao'
      AND region.org_type = 'region'
      AND area.org_type = 'area'
      AND ao.is_active = true
      AND region.is_active = true
      AND area.is_active = true
  )
  WHERE sector.org_type = 'sector';
`);
};

if (require.main === module) {
  void withTriggerManagement(db, seed)
    .then(() => SEED_LOGS && console.log("Seed done"))
    .catch((e) => {
      SEED_LOGS && console.log("Seed failed", e);
    })
    .finally(() => {
      process.exit();
    });
}
const _resetSequences = async () => {
  // Update the orgs id sequence to handle the manual id insertion
  // Keywords don't have an id sequence
  const [maxOrgId] = await db
    .select({ max: sql<number>`max(${schema.orgs.id})` })
    .from(schema.orgs);
  const [maxEventId] = await db
    .select({ max: sql<number>`max(${schema.events.id})` })
    .from(schema.events);
  const [maxLocationId] = await db
    .select({ max: sql<number>`max(${schema.locations.id})` })
    .from(schema.locations);
  if (
    maxOrgId == undefined ||
    maxLocationId == undefined ||
    maxEventId == undefined
  ) {
    console.error("Failed to get max ids", {
      maxOrgId,
      maxLocationId,
      maxEventId,
    });
    throw new Error("Failed to get max ids");
  }
  await db.execute(sql`
    SELECT setval('orgs_id_seq', (${maxOrgId.max} + 1));
  `);
  await db.execute(sql`
    SELECT setval('locations_id_seq', (${maxLocationId.max} + 1));
  `);
  await db.execute(sql`
    SELECT setval('events_id_seq', (${maxEventId.max} + 1));
  `);
};
