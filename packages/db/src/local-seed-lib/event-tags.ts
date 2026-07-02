import { and, eq, isNull } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { EVENT_TAGS } from "./data";

export async function seedEventTags(db: AppDb): Promise<void> {
  for (const eventTag of EVENT_TAGS) {
    const [existingEventTag] = await db
      .select({ id: schema.eventTags.id })
      .from(schema.eventTags)
      .where(
        and(
          eq(schema.eventTags.name, eventTag.name),
          isNull(schema.eventTags.specificOrgId),
        ),
      )
      .limit(1);

    if (existingEventTag) {
      await db
        .update(schema.eventTags)
        .set({ color: eventTag.color, isActive: true })
        .where(eq(schema.eventTags.id, existingEventTag.id));
      continue;
    }

    await db.insert(schema.eventTags).values(eventTag);
    console.log(`  + Inserted event tag: ${eventTag.name}`);
  }
}
