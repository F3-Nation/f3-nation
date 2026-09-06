import { describe, expect, it } from "vitest";

import {
  isInstanceEventId,
  resolveAoId,
  resolveEditableEventId,
} from "~/app/_components/map/location-edit-buttons";
import { resolveModalEventId } from "~/app/_components/modal/workout-details-modal";

describe("resolveModalEventId", () => {
  const events = [{ id: 10 }, { id: 20 }];

  it("uses an explicitly provided event id", () => {
    expect(
      resolveModalEventId({
        dataEventId: 20,
        selectedEventId: 10,
        events,
      }),
    ).toBe(20);
  });

  it("keeps an instance-derived id rather than falling back to another event", () => {
    // Instance ids are negative and never appear in `events`, which holds
    // series events only. Falling through here would point the edit buttons at
    // event 10 — a workout the user never selected.
    expect(
      resolveModalEventId({
        dataEventId: undefined,
        selectedEventId: -42,
        events,
      }),
    ).toBe(-42);
  });

  it("keeps an instance-derived id even when the location has no events", () => {
    expect(
      resolveModalEventId({
        dataEventId: undefined,
        selectedEventId: -42,
        events: [],
      }),
    ).toBe(-42);
  });

  it("keeps the selected event when it belongs to the location", () => {
    expect(
      resolveModalEventId({
        dataEventId: undefined,
        selectedEventId: 20,
        events,
      }),
    ).toBe(20);
  });

  it("falls back to the first event when the selection is unrelated", () => {
    expect(
      resolveModalEventId({
        dataEventId: undefined,
        selectedEventId: 999,
        events,
      }),
    ).toBe(10);
  });

  it("returns null when there is nothing to select", () => {
    expect(
      resolveModalEventId({
        dataEventId: undefined,
        selectedEventId: null,
        events: [],
      }),
    ).toBeNull();
  });
});

describe("resolveEditableEventId", () => {
  const events = [{ id: 10 }, { id: 20 }];

  it("passes a series event id through untouched", () => {
    expect(
      resolveEditableEventId({
        selectedEventId: 20,
        upcomingInstances: undefined,
        events,
      }),
    ).toBe(20);
  });

  it("resolves an instance id to its parent series event", () => {
    expect(
      resolveEditableEventId({
        selectedEventId: -42,
        upcomingInstances: [{ id: 42, seriesId: 20 }],
        events,
      }),
    ).toBe(20);
  });

  it("returns null for a one-off instance with no parent series", () => {
    expect(
      resolveEditableEventId({
        selectedEventId: -42,
        upcomingInstances: [{ id: 42, seriesId: null }],
        events,
      }),
    ).toBeNull();
  });

  it("returns null when the parent series is not at this location", () => {
    // The edit forms act on the parent series, so pointing them at an event
    // this location does not own would edit an unrelated workout.
    expect(
      resolveEditableEventId({
        selectedEventId: -42,
        upcomingInstances: [{ id: 42, seriesId: 999 }],
        events,
      }),
    ).toBeNull();
  });

  it("returns null while the instances query is still loading", () => {
    expect(
      resolveEditableEventId({
        selectedEventId: -42,
        upcomingInstances: undefined,
        events,
      }),
    ).toBeNull();
  });

  it("returns null when there is no selection", () => {
    expect(
      resolveEditableEventId({
        selectedEventId: null,
        upcomingInstances: [{ id: 42, seriesId: 20 }],
        events,
      }),
    ).toBeNull();
  });
});

describe("resolveAoId", () => {
  it("prefers the selected event's AO", () => {
    expect(
      resolveAoId({
        selectedEventAoId: 1,
        eventAoIds: [2, 3],
      }),
    ).toBe(1);
  });

  it("falls back to the first event's AO", () => {
    expect(
      resolveAoId({
        selectedEventAoId: undefined,
        eventAoIds: [2, 3],
      }),
    ).toBe(2);
  });

  it("returns null for a location with no events", () => {
    // An instance-only marker. The AO relationship reaches a location only
    // through its events, so there is nothing to act on and the caller hides
    // every edit button rather than opening a form that cannot submit.
    expect(
      resolveAoId({
        selectedEventAoId: undefined,
        eventAoIds: [],
      }),
    ).toBeNull();
  });

  it("returns null when the first event has no AO", () => {
    expect(
      resolveAoId({
        selectedEventAoId: undefined,
        eventAoIds: [null],
      }),
    ).toBeNull();
  });
});

describe("isInstanceEventId", () => {
  it("treats a negated instance id as an instance", () => {
    expect(isInstanceEventId(-42)).toBe(true);
  });

  it("treats a series event id as not an instance", () => {
    expect(isInstanceEventId(42)).toBe(false);
  });

  it("treats no selection as not an instance", () => {
    expect(isInstanceEventId(null)).toBe(false);
    expect(isInstanceEventId(undefined)).toBe(false);
  });
});
