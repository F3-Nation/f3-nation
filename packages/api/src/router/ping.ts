import { publicProcedure } from "../shared";

export const pingRouter = publicProcedure.handler(() => ({
  alive: true,
  timestamp: new Date(),
}));
