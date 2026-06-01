import { and, eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { findOrInsertOrg  } from "./core";
import type {OrgIds} from "./core";
import { AOS, AREAS, NATION, REGIONS, SECTORS } from "./data";

export async function seedOrgHierarchy(db: AppDb): Promise<OrgIds> {
  // 1. F3 Nation org (root — no parentId, specific log format)
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
    sectorIds[sector.name] = await findOrInsertOrg(
      db,
      { ...sector, parentId: nationId },
      "sector",
    );
  }

  // 3. Areas
  const areaIds: Record<string, number> = {};
  for (const area of AREAS) {
    const sectorId = sectorIds[area.sectorName];
    if (!sectorId) throw new Error(`Sector not found: ${area.sectorName}`);
    const { sectorName: _, ...areaData } = area;
    areaIds[area.name] = await findOrInsertOrg(
      db,
      { ...areaData, parentId: sectorId },
      "area",
    );
  }

  // 4. Regions
  const regionIds: Record<string, number> = {};
  for (const region of REGIONS) {
    const areaId = areaIds[region.areaName];
    if (!areaId) throw new Error(`Area not found: ${region.areaName}`);
    const { areaName: _, ...regionData } = region;
    regionIds[region.name] = await findOrInsertOrg(
      db,
      { ...regionData, parentId: areaId },
      "region",
    );
  }

  // 5. AOs (org insertion only; locations + events are handled in events.ts)
  const aoIds: Record<string, number> = {};
  for (const ao of AOS) {
    const regionId = regionIds[ao.regionName];
    if (!regionId) throw new Error(`Region not found: ${ao.regionName}`);
    const {
      regionName: _,
      latitude: _lat,
      longitude: _lon,
      addressCity: _city,
      addressState: _state,
      ...aoData
    } = ao;
    aoIds[ao.name] = await findOrInsertOrg(
      db,
      { ...aoData, parentId: regionId },
      "AO",
    );
  }

  return { nationId, sectorIds, areaIds, regionIds, aoIds };
}
