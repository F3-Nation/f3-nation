import { apiRouter } from "./router/api";
import { apiKeyRouter } from "./router/api-key";
import { authRouter } from "./router/auth";
import { eventRouter } from "./router/event";
import { eventTypeRouter } from "./router/event-type";
import { feedbackRouter } from "./router/feedback";
import { locationRouter } from "./router/location";
import { orgRouter } from "./router/org";
import { pingRouter } from "./router/ping";
import { requestRouter } from "./router/request";
import { userRouter } from "./router/user";

export const router = {
  api: apiRouter,
  apiKey: apiKeyRouter,
  auth: authRouter,
  org: orgRouter,
  feedback: feedbackRouter,
  ping: pingRouter,
  location: locationRouter,
  user: userRouter,
  request: requestRouter,
  event: eventRouter,
  eventType: eventTypeRouter,
};
