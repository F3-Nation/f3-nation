import { publicProcedure } from "../shared";

export const pingRouter = publicProcedure
  .route({
    method: "GET",
    path: "/ping",
    tags: ["ping"],
    summary: "Health check",
    description:
      "Check if the API is alive and responding. No authentication required. Useful for monitoring and testing connectivity.",
  })
  .handler(() => ({
    alive: true,
    timestamp: new Date(),
  }));
