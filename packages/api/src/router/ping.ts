import { publicProcedure } from "../trpc";

export const pingRouter = publicProcedure.query(() => ({
  alive: true,
  timestamp: new Date(),
}));
