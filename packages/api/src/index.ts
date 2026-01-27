import { os } from "@orpc/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";

import { apiKeyRouter } from "./router/api-key";
import { attendanceRouter } from "./router/attendance";
import { eventRouter } from "./router/event";
import { eventInstanceRouter } from "./router/event-instance";
import { eventTagRouter } from "./router/event-tag";
import { eventTypeRouter } from "./router/event-type";
import { locationRouter } from "./router/location";
import { mapRouter } from "./router/map/index";
import { orgRouter } from "./router/org";
import { pingRouter } from "./router/ping";
import { requestRouter } from "./router/request";
import { slackRouter } from "./router/slack";
import { userRouter } from "./router/user";

export const router = os.prefix(API_PREFIX_V1).router({
  apiKey: os.prefix("/api-key").router(apiKeyRouter),
  attendance: os.prefix("/attendance").router(attendanceRouter),
  event: os.prefix("/event").router(eventRouter),
  eventInstance: os.prefix("/event-instance").router(eventInstanceRouter),
  eventTag: os.prefix("/event-tag").router(eventTagRouter),
  eventType: os.prefix("/event-type").router(eventTypeRouter),
  ping: os.router(pingRouter),
  location: os.prefix("/location").router(locationRouter),
  map: os.prefix("/map").router(mapRouter),
  org: os.prefix("/org").router(orgRouter),
  request: os.prefix("/request").router(requestRouter),
  slack: os.prefix("/slack").router(slackRouter),
  user: os.prefix("/user").router(userRouter),
});
