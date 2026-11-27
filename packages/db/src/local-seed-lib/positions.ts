import { eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { POSITIONS } from "./data";

export async function seedPositions(db: AppDb): Promise<void> {
  // 11. Positions — global standard F3 positions (orgId null = applies to all orgs)
  //
  // Each position keeps a global row. Rows with an org id under the same name
  // are folded into it. When the name has exactly one global row and its org
  // type differs from POSITIONS, the type is corrected, so re-running the seed
  // fixes a database an older seed wrote. A name with several global rows is
  // one the nation defines once per org type, and those rows are left alone.
  for (const position of POSITIONS) {
    const existing = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.name, position.name));

    const globalRows = existing.filter((p) => p.orgId === null);
    const globalRow =
      globalRows.find((p) => p.orgType === position.orgType) ?? globalRows[0];
    const legacyRows = existing.filter((p) => p.orgId !== null);

    if (globalRow) {
      if (globalRows.length === 1 && globalRow.orgType !== position.orgType) {
        await db
          .update(schema.positions)
          .set({ orgType: position.orgType })
          .where(eq(schema.positions.id, globalRow.id));
        console.log(
          `  ~ Set position "${position.name}" org type to ${position.orgType}`,
        );
      }
      // Delete any leftover per-region duplicates
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
        .set({ orgId: null, orgType: position.orgType })
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
        orgType: position.orgType,
        isActive: true,
      });
      console.log(`  + Inserted position "${position.name}" (global)`);
    }
  }
}
