import { os } from "@orpc/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";

import { apiKeyRouter } from "./router/api-key";
import { attendanceRouter } from "./router/attendance";
import { eventRouter } from "./router/event";
import { eventInstanceRouter } from "./router/event-instance";
import { eventTagRouter } from "./router/event-tag";
import { eventTypeRouter } from "./router/event-type";
import { locationRouter } from "./router/location";
import { mailRouter } from "./router/mail";
import { mapRouter } from "./router/map/index";
import { meRouter } from "./router/me";
import { orgChartRouter } from "./router/org-chart";
import { orgRouter } from "./router/org";
import { pingRouter } from "./router/ping";
import { positionRouter } from "./router/position";
import { requestRouter } from "./router/request";
import { slackRouter } from "./router/slack";
import { userRouter } from "./router/user";

// Re-export webhook event types for external use
export { notifyMapDataChange } from "./lib/webhook-events";
export type { WebhookEvent } from "./lib/webhook-events";

export const router = os.prefix(API_PREFIX_V1).router({
  apiKey: os.prefix("/api-key").router(apiKeyRouter),
  attendance: os.prefix("/attendance").router(attendanceRouter),
  event: os.prefix("/event").router(eventRouter),
  eventInstance: os.prefix("/event-instance").router(eventInstanceRouter),
  eventTag: os.prefix("/event-tag").router(eventTagRouter),
  eventType: os.prefix("/event-type").router(eventTypeRouter),
  mail: os.prefix("/mail").router(mailRouter),
  ping: os.router(pingRouter),
  location: os.prefix("/location").router(locationRouter),
  map: os.prefix("/map").router(mapRouter),
  me: os.prefix("/me").router(meRouter),
  orgChart: os.prefix("/org-chart").router(orgChartRouter),
  org: os.prefix("/org").router(orgRouter),
  position: os.prefix("/position").router(positionRouter),
  request: os.prefix("/request").router(requestRouter),
  slack: os.prefix("/slack").router(slackRouter),
  user: os.prefix("/user").router(userRouter),
});
