import type { NextApiRequest, NextApiResponse } from "next/types";
import { createOpenApiNextHandler } from "trpc-openapi";

import { appRouter, createTRPCContext } from "@acme/api";

// If you need to enable cors, you can do so like this:
const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  // Enable cors
  // await cors(req, res);

  // Let the tRPC handler do its magic
  return createOpenApiNextHandler({
    router: appRouter,
    createContext: createTRPCContext,
    responseMeta: {
      title: "OpenAPI Example",
      description: "This is an example of an OpenAPI endpoint",
      version: "0.0.1",
    },
    onError() {
      console.error(`>>> openApi Error`);
    },
  })(req, res);
};

export default handler;
