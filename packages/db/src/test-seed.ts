import type { EventCategory, RegionRole } from "@acme/shared/app/enums";
import {
  TEST_ADMIN_ROLE_ID,
  TEST_ADMIN_USER_ID,
  TEST_AO_1_ORG_ID,
  TEST_AO_2_ORG_ID,
  TEST_AREA_ORG_ID,
  TEST_EDITOR_ROLE_ID,
  TEST_EDITOR_USER_ID,
  TEST_NATION_ORG_ID,
  TEST_REGION_1_ORG_ID,
  TEST_REGION_2_ORG_ID,
  TEST_REGION_3_ORG_ID,
  TEST_SECTOR_ORG_ID,
} from "@acme/shared/app/constants";
import { EventTypes } from "@acme/shared/app/enums";

import type { AppDb } from "./client";
import { sql } from ".";
import {
  eventTypes,
  orgs,
  roles,
  rolesXUsersXOrg,
  users,
} from "../drizzle/schema";
import { getDb } from "./utils/functions";

export const testSeed = async (db?: AppDb) => {
  const _db = db ?? getDb();
  if (!_db) {
    throw new Error("No database provided");
  }
  // Create test nation org
  await _db.insert(orgs).values({
    id: TEST_NATION_ORG_ID,
    name: "Test Nation",
    orgType: "nation",
    isActive: true,
    email: "test@org.com",
    description: "Test Nation",
    logoUrl: "https://example.com/logo.png",
    website: "https://example.com",
    twitter: "@testnation",
    facebook: "testnation",
    instagram: "@testnation",
    lastAnnualReview: new Date().toISOString(),
    meta: { key: "value" },
  });

  // Create test sector org
  await _db.insert(orgs).values({
    id: TEST_SECTOR_ORG_ID,
    name: "Test Sector",
    orgType: "sector",
    isActive: true,
    parentId: TEST_NATION_ORG_ID,
    email: "test@org.com",
    description: "Test Sector",
    logoUrl: "https://example.com/logo.png",
    website: "https://example.com",
    twitter: "@testorg",
    facebook: "testorg",
  });

  // Create test area org
  await _db.insert(orgs).values({
    id: TEST_AREA_ORG_ID,
    name: "Test Area",
    orgType: "area",
    isActive: true,
    parentId: TEST_SECTOR_ORG_ID,
    email: "test@org.com",
    description: "Test Area",
    logoUrl: "https://example.com/logo.png",
    website: "https://example.com",
    twitter: "@testorg",
  });

  // Create test region org
  await _db.insert(orgs).values([
    {
      id: TEST_REGION_1_ORG_ID,
      parentId: TEST_SECTOR_ORG_ID,
      name: "Test Region id 1",
      orgType: "region",
      isActive: true,
      email: "test@org.com",
      description: "Test Organization",
      logoUrl: "https://example.com/logo.png",
      website: "https://example.com",
      twitter: "@testorg",
      facebook: "testorg",
      instagram: "@testorg",
      lastAnnualReview: new Date().toISOString(),
      meta: { key: "value" },
    },
    {
      id: TEST_REGION_2_ORG_ID,
      parentId: TEST_SECTOR_ORG_ID,
      name: "Test Region id 2",
      orgType: "region",
      isActive: true,
      email: "test@org.com",
      description: "Test Organization",
      logoUrl: "https://example.com/logo.png",
      website: "https://example.com",
      twitter: "@testorg",
      facebook: "testorg",
      instagram: "@testorg",
      lastAnnualReview: new Date().toISOString(),
      meta: { key: "value" },
    },
    {
      id: TEST_REGION_3_ORG_ID,
      parentId: TEST_SECTOR_ORG_ID,
      name: "Test Region id 3",
      orgType: "region",
      isActive: true,
      email: "test@org.com",
      description: "Test Organization",
      logoUrl: "https://example.com/logo.png",
      website: "https://example.com",
      twitter: "@testorg",
      facebook: "testorg",
      instagram: "@testorg",
      lastAnnualReview: new Date().toISOString(),
      meta: { key: "value" },
    },
  ]);

  // Create test ao org
  await _db.insert(orgs).values([
    {
      id: TEST_AO_1_ORG_ID,
      name: "Test AO 1",
      orgType: "ao",
      isActive: true,
      parentId: TEST_REGION_1_ORG_ID,
      email: "test@org.com",
      description: "Test AO 1",
      logoUrl: "https://example.com/logo.png",
      website: "https://example.com",
      twitter: "@testorg",
    },
    {
      id: TEST_AO_2_ORG_ID,
      name: "Test AO 2",
      orgType: "ao",
      isActive: true,
      parentId: TEST_REGION_3_ORG_ID,
      email: "test@org.com",
      description: "Test AO 2",
      logoUrl: "https://example.com/logo.png",
      website: "https://example.com",
      twitter: "@testorg",
    },
  ]);

  // Create editor and admin roles
  const [editorRole, adminRole] = await Promise.all([
    _db
      .insert(roles)
      .values({
        id: TEST_EDITOR_ROLE_ID,
        name: "editor" as RegionRole,
        description: "Editor role",
      })
      .returning(),
    _db
      .insert(roles)
      .values({
        id: TEST_ADMIN_ROLE_ID,
        name: "admin" as RegionRole,
        description: "Admin role",
      })
      .returning(),
  ]);

  if (!editorRole[0] || !adminRole[0]) {
    throw new Error("Failed to create roles");
  }

  // Create test user
  const [editorUser, adminUser] = await _db
    .insert(users)
    .values([
      {
        id: TEST_EDITOR_USER_ID,
        email: "test@test.com",
        f3Name: "Test User",
        meta: { key: "value" },
      },
      {
        id: TEST_ADMIN_USER_ID,
        email: "admin@test.com",
        f3Name: "Admin User",
        meta: { key: "value" },
      },
    ])
    .returning();

  if (!editorUser || !adminUser) {
    throw new Error("Failed to create test users");
  }

  // Associate roles with user
  await _db.insert(rolesXUsersXOrg).values([
    {
      roleId: TEST_EDITOR_ROLE_ID,
      userId: TEST_EDITOR_USER_ID,
      orgId: TEST_REGION_2_ORG_ID,
    },
    {
      roleId: TEST_ADMIN_ROLE_ID,
      userId: TEST_EDITOR_USER_ID,
      orgId: TEST_REGION_3_ORG_ID,
    },
    {
      roleId: TEST_ADMIN_ROLE_ID,
      userId: TEST_ADMIN_USER_ID,
      orgId: TEST_NATION_ORG_ID,
    },
  ]);

  // Insert event types
  await _db.insert(eventTypes).values(
    Object.values(EventTypes).map((eventType) => ({
      name: eventType,
      eventCategory: "first_f" as EventCategory,
    })),
  );

  // Update the orgs id sequence to handle the manual id insertion
  await _db.execute(sql`
    SELECT setval('orgs_id_seq', (SELECT MAX(id) FROM orgs));
  `);

  // Update the roles id sequence to handle the manual id insertion
  await _db.execute(sql`
    SELECT setval('roles_id_seq', (SELECT MAX(id) FROM roles));
  `);

  // Update the users id sequence to handle the manual id insertion
  await _db.execute(sql`
    SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
  `);
};
