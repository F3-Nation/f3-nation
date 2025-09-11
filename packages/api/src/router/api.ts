import { revalidatePath } from "next/cache";

import { apiKeyProcedure, createTRPCRouter } from "../trpc";

export const apiRouter = createTRPCRouter({
  revalidate: apiKeyProcedure.mutation(async () => {
    revalidatePath("/");
    return Promise.resolve();
  }),
});
