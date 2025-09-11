import axios from "axios";

import { env } from "@acme/env";

// You guys both wanted webhooks to let you know when the map data is updated, right? I now have that functional, but will need your hardcoded webhook urls. Can you share those with me? In the future I’ll allow them to be dynamic but for now was hoping to doing something light. It will just send a post or get (whichever you want) whenever the data changes. I will likely send a payload like this:
// {
// eventId?: number,
// locationId?: number,
// orgId?: number
// }
// where all 3 might be updated or undefined

interface Webhook {
  url: string;
  method: "POST" | "GET";
}

const webhooks: Webhook[] = [
  {
    url: `${env.NEXT_PUBLIC_URL}/api/trpc/ping`,
    method: "GET",
  },
];

if (env.NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED) {
  webhooks.push(
    ...env.NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED.split(",").map((url) => ({
      url,
      method: "POST" as const,
    })),
  );
}

export const notifyWebhooks = async (mapData: {
  eventId?: number;
  locationId?: number;
  orgId?: number;
  action: "map.updated" | "map.created" | "map.deleted";
}) => {
  const { eventId, locationId, orgId, action } = mapData;
  const data = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    action,
    channel: env.NEXT_PUBLIC_CHANNEL,
    data: { eventId, locationId, orgId },
  };
  for (const webhook of webhooks) {
    if (webhook.method === "POST") {
      await axios.post(webhook.url, data, {
        method: webhook.method,
      });
    } else if (webhook.method === "GET") {
      await axios.get(webhook.url, {
        method: webhook.method,
      });
    }
  }
};
