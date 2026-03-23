import { publicProcedure } from "../shared";
import { z } from "zod";

export const pingRouter = publicProcedure
  .route({
    method: "GET",
    path: "/ping",
    tags: ["ping"],
    summary: "Health check",
    description:
      "Check if the API is alive and responding. No authentication required. Useful for monitoring and testing connectivity.",
  })
  .output(
    z.object({
      alive: z.boolean().describe("Whether the API is alive"),
      timestamp: z.date().describe("The timestamp of the ping"),
    }),
  )
  .handler(() => ({
    alive: true,
    timestamp: new Date(),
  }));
