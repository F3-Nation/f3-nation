import { eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { ATTENDANCE_TYPES } from "./data";

export async function seedAttendanceTypes(db: AppDb): Promise<void> {
  const existingAttendanceTypes = await db
    .select()
    .from(schema.attendanceTypes);
  const existingIds = new Set(existingAttendanceTypes.map((type) => type.id));
  const existingTypes = new Set(
    existingAttendanceTypes.map((attendanceType) => attendanceType.type),
  );

  for (const attendanceType of ATTENDANCE_TYPES) {
    if (existingIds.has(attendanceType.id)) {
      await db
        .update(schema.attendanceTypes)
        .set({ type: attendanceType.type })
        .where(eq(schema.attendanceTypes.id, attendanceType.id));
      continue;
    }

    if (existingTypes.has(attendanceType.type)) {
      continue;
    }

    await db.insert(schema.attendanceTypes).values(attendanceType);
    console.log(`  + Inserted attendance type: ${attendanceType.type}`);
  }
}
