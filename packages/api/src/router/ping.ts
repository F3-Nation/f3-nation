import { publicProcedure } from "../shared";

export const pingRouter = publicProcedure
  .route({
    method: "GET",
    path: "/ping",
    tags: ["ping"],
    summary: "Health check",
    description: "Check if the API is alive and responding",
  })
  .handler(() => ({
    alive: true,
    timestamp: new Date(),
  }));
