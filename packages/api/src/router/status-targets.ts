import { isDevelopment } from "@acme/shared/common/constants";
import type { StatusTarget } from "./status";

const isLocal = isDevelopment;

export const STATUS_TARGETS: StatusTarget[] = [
  {
    id: "me",
    label: "F3 Me",
    url: isLocal
      ? "http://localhost:3003/health"
      : "https://me.f3nation.com/health",
    source: "contract",
  },
  {
    id: "slack",
    label: "Slack",
    url: "https://status.slack.com",
    source: "external",
    provider: "slack",
    apiUrl: "https://slack-status.com/api/v2.0.0/current",
  },
];
