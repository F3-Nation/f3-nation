import { revalidatePath } from "next/cache";

import { apiKeyProcedure, publicProcedure } from "../shared";

export const apiRouter = {
  revalidate: apiKeyProcedure.handler(async () => {
    revalidatePath("/");
    return Promise.resolve();
  }),
  docs: publicProcedure
    .route({ method: "GET", path: "/" })
    .handler(async () => {
      return Promise.resolve();
    }),
};
