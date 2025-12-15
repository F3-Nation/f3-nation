import { os } from "@orpc/server";

import { API_PREFIX_V1 } from "@acme/shared/app/constants";

import { apiKeyRouter } from "./router/api-key";
import { eventRouter } from "./router/event";
import { eventTypeRouter } from "./router/event-type";
import { locationRouter } from "./router/location";
import { mapRouter } from "./router/map/index";
import { orgRouter } from "./router/org";
import { pingRouter } from "./router/ping";
import { requestRouter } from "./router/request";
import { userRouter } from "./router/user";

export const router = os.prefix(API_PREFIX_V1).router({
  apiKey: os.prefix("/api-key").router(apiKeyRouter),
  event: os.prefix("/event").router(eventRouter),
  eventType: os.prefix("/event-type").router(eventTypeRouter),
  ping: os.router(pingRouter),
  location: os.prefix("/location").router(locationRouter),
  map: os.prefix("/map").router(mapRouter),
  org: os.prefix("/org").router(orgRouter),
  request: os.prefix("/request").router(requestRouter),
  user: os.prefix("/user").router(userRouter),
});
