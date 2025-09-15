import { revalidatePath } from "next/cache";

import { apiKeyProcedure } from "../shared";

export const apiRouter = {
  revalidate: apiKeyProcedure.handler(async () => {
    revalidatePath("/");
    return Promise.resolve();
  }),
};
