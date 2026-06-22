import { eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { POSITIONS } from "./data";

export async function seedPositions(db: AppDb): Promise<void> {
  // 11. Positions — global standard F3 positions (orgId null = applies to all orgs)
  //
  // Migration note: earlier versions seeded positions per-region (orgId = regionId).
  // On re-run we migrate any such rows to global (orgId = null) and deduplicate.
  for (const position of POSITIONS) {
    const existing = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.name, position.name));

    const globalRow = existing.find((p) => p.orgId === null);
    const legacyRows = existing.filter((p) => p.orgId !== null);

    if (globalRow) {
      // Already a global row — delete any leftover per-region duplicates
      for (const legacy of legacyRows) {
        await db
          .delete(schema.positions)
          .where(eq(schema.positions.id, legacy.id));
      }
    } else if (legacyRows.length > 0) {
      // Migrate first legacy row to global, delete the rest
      const [first, ...rest] = legacyRows;
      await db
        .update(schema.positions)
        .set({ orgId: null, orgType: "region" })
        .where(eq(schema.positions.id, first!.id));
      for (const dup of rest) {
        await db
          .delete(schema.positions)
          .where(eq(schema.positions.id, dup.id));
      }
      console.log(`  ~ Migrated position "${position.name}" to global`);
    } else {
      await db.insert(schema.positions).values({
        name: position.name,
        description: position.description,
        orgId: null,
        orgType: "region",
        isActive: true,
      });
      console.log(`  + Inserted position "${position.name}" (global)`);
    }
  }
}
