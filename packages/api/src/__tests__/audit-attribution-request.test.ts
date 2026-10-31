import type { Session } from "@acme/auth";
import type { AppDb } from "@acme/db/client";
import { eq, schema, sql } from "@acme/db";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { waitForRegionNotificationTasks } from "../router/request";
import {
  cleanup,
  createTestClient,
  createUserSession,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "./test-utils";

const notifications = vi.hoisted(() => ({
  pending: vi.fn(),
  map: vi.fn(),
  region: vi.fn(),
}));

vi.mock("../services/map-request-notification", () => ({
  notifyMapChangeRequest: notifications.pending,
}));
vi.mock("../lib/webhook-events", () => ({
  notifyMapDataChange: notifications.map,
}));
vi.mock("../lib/first-event-service", () => ({
  maybeNotifyRegionInABox: notifications.region,
}));

describe("request audit attribution", () => {
  const requestIds: string[] = [];
  const eventIds: number[] = [];
  const locationIds: number[] = [];
  const orgIds: number[] = [];
  const eventTypeIds: number[] = [];
  const userIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    notifications.pending.mockReset().mockResolvedValue(undefined);
    notifications.region.mockReset().mockResolvedValue(undefined);
  });

  afterEach(waitForRegionNotificationTasks);

  afterAll(async () => {
    for (const id of requestIds.reverse()) await cleanup.updateRequest(id);
    for (const id of eventIds.reverse()) await cleanup.event(id);
    for (const id of locationIds.reverse()) await cleanup.location(id);
    for (const id of orgIds.reverse()) await cleanup.org(id);
    for (const id of eventTypeIds.reverse()) await cleanup.eventType(id);
    for (const id of userIds.reverse()) await cleanup.user(id);
  });

  const fixture = async () => {
    const nation = await getOrCreateF3NationOrg();
    const suffix = uniqueId();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Request audit region ${suffix}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning();
    if (!region) throw new Error("Missing synthetic region");
    orgIds.push(region.id);
    const [eventType] = await db
      .insert(schema.eventTypes)
      .values({
        name: `Request audit type ${suffix}`,
        eventCategory: "first_f",
      })
      .returning();
    if (!eventType) throw new Error("Missing synthetic event type");
    eventTypeIds.push(eventType.id);
    const [submitter, reviewer] = await db
      .insert(schema.users)
      .values([
        { email: `request-submitter-${suffix}@example.com` },
        { email: `request-reviewer-${suffix}@example.com` },
      ])
      .returning();
    if (!submitter || !reviewer) throw new Error("Missing synthetic users");
    userIds.push(submitter.id, reviewer.id);

    const submitterSession = createUserSession({
      userId: submitter.id,
      email: submitter.email,
    });
    const reviewerSession = createUserSession({
      userId: reviewer.id,
      email: reviewer.email,
    });
    const roles = [
      { orgId: region.id, orgName: region.name, roleName: "editor" as const },
    ];
    reviewerSession.roles = roles;
    reviewerSession.user = { ...reviewerSession.user, roles };

    const input = {
      id: crypto.randomUUID(),
      requestType: "create_ao_and_location_and_event" as const,
      submittedBy: "client-supplied@example.com",
      originalRegionId: region.id,
      aoName: `Request audit AO ${suffix}`,
      eventName: `Request audit event ${suffix}`,
      eventDayOfWeek: "monday" as const,
      eventStartTime: "0530",
      eventEndTime: "0615",
      eventTypeIds: [eventType.id],
      locationLat: 35.5,
      locationLng: -80.5,
      locationAddress: `Audit address ${suffix}`,
    };
    requestIds.push(input.id);
    return { region, eventType, submitterSession, reviewerSession, input };
  };

  const asApiKey = (session: Session): Session => ({
    ...session,
    apiKey: {
      id: 1,
      key: "synthetic-request-key",
      ownerId: session.id,
      revokedAt: null,
      expiresAt: null,
      orgIds: session.roles?.map((role) => role.orgId) ?? [],
    },
  });

  const requestHistory = (id: string) =>
    db.execute(sql`
      SELECT op, changed_by, changed_via, new_row->>'status' AS status
      FROM public_history.update_requests WHERE row_id = ${id} ORDER BY id
    `);

  const findCreatedEntities = async (id: string) => {
    const request = await db.query.updateRequests.findFirst({
      where: eq(schema.updateRequests.id, id),
    });
    if (request?.eventId) eventIds.push(request.eventId);
    if (request?.locationId) locationIds.push(request.locationId);
    if (request?.aoId) orgIds.push(request.aoId);
    if (!request?.eventId || !request.locationId || !request.aoId) {
      throw new Error("Approved request did not link created entities");
    }
    return {
      eventId: request.eventId,
      locationId: request.locationId,
      aoId: request.aoId,
    };
  };

  const entityHistory = (ids: {
    eventId: number;
    locationId: number;
    aoId: number;
  }) =>
    db.execute(sql`
      SELECT 'events' AS entity, op, changed_by, changed_via
      FROM public_history.events WHERE row_id = ${String(ids.eventId)}
      UNION ALL
      SELECT 'event_types', op, changed_by, changed_via
      FROM public_history.events_x_event_types
      WHERE new_row->>'event_id' = ${String(ids.eventId)}
      UNION ALL
      SELECT 'locations', op, changed_by, changed_via
      FROM public_history.locations WHERE row_id = ${String(ids.locationId)}
      UNION ALL
      SELECT 'orgs', op, changed_by, changed_via
      FROM public_history.orgs WHERE row_id = ${String(ids.aoId)}
      ORDER BY entity
    `);

  it("attributes pending submission to the session actor and keeps it committed when notification fails", async () => {
    const { input, submitterSession } = await fixture();
    await mockAuthWithSession(submitterSession);
    let notificationDb: AppDb | undefined;
    let observedHistory: unknown;
    let observedStatus: string | undefined;
    notifications.pending.mockImplementationOnce(
      async ({
        db: suppliedDb,
        requestId,
      }: {
        db: AppDb;
        requestId: string;
      }) => {
        notificationDb = suppliedDb;
        observedStatus = (
          await db.query.updateRequests.findFirst({
            where: eq(schema.updateRequests.id, requestId),
          })
        )?.status;
        observedHistory = await requestHistory(requestId);
        throw new Error("Synthetic notification failure");
      },
    );

    const result =
      await createTestClient().request.submitCreateAOAndLocationAndEventRequest(
        input,
      );

    expect(result).toEqual({
      status: "pending",
      updateRequest: { id: input.id },
    });
    expect(notificationDb).toBe(db);
    expect(observedStatus).toBe("pending");
    const expectedHistory = [
      {
        op: "I",
        changed_by: submitterSession.id,
        changed_via: null,
        status: "pending",
      },
    ];
    expect(observedHistory).toEqual(expectedHistory);
    expect(await requestHistory(input.id)).toEqual(expectedHistory);
    expect(
      await db.query.updateRequests.findFirst({
        where: eq(schema.updateRequests.id, input.id),
      }),
    ).toMatchObject({
      status: "pending",
      submittedBy: submitterSession.user?.email,
      reviewedBy: null,
      aoId: null,
      locationId: null,
      eventId: null,
    });
    expect(
      await db.query.events.findFirst({
        where: eq(schema.events.name, input.eventName),
      }),
    ).toBeUndefined();
    expect(notifications.map).not.toHaveBeenCalled();
    expect(notifications.region).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "attributes approved nested writes to the reviewer (API key: %s)",
    async (apiKey) => {
      const { input, submitterSession, reviewerSession, region, eventType } =
        await fixture();
      await mockAuthWithSession(submitterSession);
      await createTestClient().request.submitCreateAOAndLocationAndEventRequest(
        input,
      );
      await mockAuthWithSession(
        apiKey ? asApiKey(reviewerSession) : reviewerSession,
      );
      let notificationDb: AppDb | undefined;
      let observedHistory: unknown;
      notifications.region.mockImplementationOnce(async (suppliedDb: AppDb) => {
        notificationDb = suppliedDb;
        observedHistory = await requestHistory(input.id);
      });

      const result =
        await createTestClient().request.validateSubmissionByAdmin(input);
      const ids = await findCreatedEntities(input.id);
      await waitForRegionNotificationTasks();

      expect(result).toEqual({
        status: "approved",
        updateRequest: { id: input.id },
      });
      const actor = apiKey ? null : reviewerSession.id;
      const expectedHistory = [
        {
          op: "I",
          changed_by: submitterSession.id,
          changed_via: null,
          status: "pending",
        },
        { op: "U", changed_by: actor, changed_via: null, status: "approved" },
      ];
      expect(await requestHistory(input.id)).toEqual(expectedHistory);
      expect(observedHistory).toEqual(expectedHistory);
      expect(notificationDb).toBe(db);
      const histories = await entityHistory(ids);
      expect(histories).toHaveLength(4);
      expect(histories).toEqual(
        expect.arrayContaining([
          {
            entity: "event_types",
            op: "I",
            changed_by: actor,
            changed_via: null,
          },
          { entity: "events", op: "I", changed_by: actor, changed_via: null },
          {
            entity: "locations",
            op: "I",
            changed_by: actor,
            changed_via: null,
          },
          { entity: "orgs", op: "I", changed_by: actor, changed_via: null },
        ]),
      );
      expect(
        await db.query.events.findFirst({
          where: eq(schema.events.id, ids.eventId),
        }),
      ).toMatchObject({
        name: input.eventName,
        orgId: ids.aoId,
        locationId: ids.locationId,
        isActive: true,
      });
      expect(
        await db.query.orgs.findFirst({ where: eq(schema.orgs.id, ids.aoId) }),
      ).toMatchObject({
        name: input.aoName,
        parentId: region.id,
        defaultLocationId: ids.locationId,
      });
      expect(
        await db.query.locations.findFirst({
          where: eq(schema.locations.id, ids.locationId),
        }),
      ).toMatchObject({
        orgId: region.id,
        latitude: input.locationLat,
        longitude: input.locationLng,
      });
      expect(
        await db
          .select()
          .from(schema.eventsXEventTypes)
          .where(eq(schema.eventsXEventTypes.eventId, ids.eventId)),
      ).toEqual([{ eventId: ids.eventId, eventTypeId: eventType.id }]);
    },
  );

  it.each([false, true])(
    "attributes rejection to the decision maker (API key: %s)",
    async (apiKey) => {
      const { input, submitterSession, reviewerSession } = await fixture();
      await mockAuthWithSession(submitterSession);
      await createTestClient().request.submitCreateAOAndLocationAndEventRequest(
        input,
      );
      await mockAuthWithSession(
        apiKey ? asApiKey(reviewerSession) : reviewerSession,
      );

      expect(
        await createTestClient().request.rejectSubmission({ id: input.id }),
      ).toEqual({ status: "rejected" });
      expect(await requestHistory(input.id)).toEqual([
        {
          op: "I",
          changed_by: submitterSession.id,
          changed_via: null,
          status: "pending",
        },
        {
          op: "U",
          changed_by: apiKey ? null : reviewerSession.id,
          changed_via: null,
          status: "rejected",
        },
      ]);
      expect(
        await db.query.updateRequests.findFirst({
          where: eq(schema.updateRequests.id, input.id),
        }),
      ).toMatchObject({
        status: "rejected",
        reviewedBy: reviewerSession.user?.email,
      });
      expect(
        await db.query.events.findFirst({
          where: eq(schema.events.name, input.eventName),
        }),
      ).toBeUndefined();
      await expect(
        createTestClient().request.rejectSubmission({ id: input.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await requestHistory(input.id)).toHaveLength(2);
    },
  );

  it("does not attribute an API-key submission to its owner", async () => {
    const { input, submitterSession } = await fixture();
    await mockAuthWithSession(asApiKey(submitterSession));

    const result =
      await createTestClient().request.submitCreateAOAndLocationAndEventRequest(
        input,
      );

    expect(result.status).toBe("pending");
    expect(await requestHistory(input.id)).toEqual([
      { op: "I", changed_by: null, changed_via: null, status: "pending" },
    ]);
  });

  it("rolls back source and history after a nested write fails without sending notifications", async () => {
    const { input, reviewerSession } = await fixture();
    await mockAuthWithSession(reviewerSession);

    await expect(
      createTestClient().request.submitCreateAOAndLocationAndEventRequest({
        ...input,
        eventTypeIds: [2_147_483_647],
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await waitForRegionNotificationTasks();

    expect(
      await db.query.updateRequests.findFirst({
        where: eq(schema.updateRequests.id, input.id),
      }),
    ).toBeUndefined();
    expect(
      await db.query.orgs.findFirst({
        where: eq(schema.orgs.name, input.aoName),
      }),
    ).toBeUndefined();
    expect(
      await db.query.locations.findFirst({
        where: eq(schema.locations.addressStreet, input.locationAddress),
      }),
    ).toBeUndefined();
    expect(
      await db.query.events.findFirst({
        where: eq(schema.events.name, input.eventName),
      }),
    ).toBeUndefined();
    expect(await requestHistory(input.id)).toEqual([]);
    expect(
      await db.execute(sql`
      SELECT id FROM public_history.orgs WHERE new_row->>'name' = ${input.aoName}
      UNION ALL
      SELECT id FROM public_history.locations WHERE new_row->>'address_street' = ${input.locationAddress}
      UNION ALL
      SELECT id FROM public_history.events WHERE new_row->>'name' = ${input.eventName}
    `),
    ).toEqual([]);
    expect(notifications.pending).not.toHaveBeenCalled();
    expect(notifications.map).not.toHaveBeenCalled();
    expect(notifications.region).not.toHaveBeenCalled();
  });

  it("keeps a pending request unchanged when a reviewer belongs to another region", async () => {
    const { input, submitterSession, reviewerSession } = await fixture();
    const { region: unrelated } = await fixture();
    await mockAuthWithSession(submitterSession);
    await createTestClient().request.submitCreateAOAndLocationAndEventRequest(
      input,
    );
    reviewerSession.roles = [
      { orgId: unrelated.id, orgName: unrelated.name, roleName: "editor" },
    ];
    reviewerSession.user = {
      ...reviewerSession.user,
      roles: reviewerSession.roles,
    };
    await mockAuthWithSession(reviewerSession);

    await expect(
      createTestClient().request.validateSubmissionByAdmin(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createTestClient().request.rejectSubmission({ id: input.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      await db.query.updateRequests.findFirst({
        where: eq(schema.updateRequests.id, input.id),
      }),
    ).toMatchObject({ status: "pending", reviewedBy: null });
    expect(await requestHistory(input.id)).toEqual([
      {
        op: "I",
        changed_by: submitterSession.id,
        changed_via: null,
        status: "pending",
      },
    ]);
  });
});
