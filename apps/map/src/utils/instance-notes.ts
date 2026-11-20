/**
 * Where an upcoming instance's own description shows on the map. A series
 * date's note explains its change, so it sits beside that change in the
 * updates callout. A one-off has no series to differ from, so its description
 * is the workout's Notes. Each note shows in exactly one of the two places.
 */
interface InstanceNoteSource {
  seriesId: number | null;
  description: string | null;
}

/** The note shown under this instance's row in the updates callout. */
export function calloutNote(instance: InstanceNoteSource): string | null {
  return instance.seriesId != null ? instance.description : null;
}

/** The Notes shown when this instance is opened as its own workout. */
export function instanceNotes(instance: InstanceNoteSource): string | null {
  return instance.seriesId == null ? instance.description : null;
}
