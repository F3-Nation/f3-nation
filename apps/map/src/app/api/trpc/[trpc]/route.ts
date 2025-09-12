/* eslint-disable no-case-declarations */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter, createTRPCContext } from "@acme/api";
import { notifyWebhooks } from "@acme/api/lib/notify-webhooks";
import { auth } from "@acme/auth";

import type { RouterOutputs } from "~/trpc/types";

const updateDataPath = [
  "event.crupdate",
  "event.delete",
  "location.crupdate",
  "location.delete",
  "org.crupdate",
  "org.delete",
  "request.validateSubmissionByAdmin",
  "request.validateDeleteByAdmin",
] as const;

const conditionalDataPath = [
  "request.submitUpdateRequest",
  "request.submitDeleteRequest",
] as const;
const REQUEST_FAILED_ERROR = "Request failed";
const NO_TRPC_ROUTE_ERROR = "No trpc route found";
const NO_DATA_MODIFICATION_ERROR = "No data modification found";

interface TrpcResponse<
  T extends
    | RouterOutputs["event"]["crupdate"]
    | RouterOutputs["event"]["delete"]
    | RouterOutputs["location"]["crupdate"]
    | RouterOutputs["location"]["delete"]
    | RouterOutputs["org"]["crupdate"]
    | RouterOutputs["org"]["delete"]
    | RouterOutputs["request"]["submitUpdateRequest"]
    | RouterOutputs["request"]["submitDeleteRequest"]
    | RouterOutputs["request"]["validateSubmissionByAdmin"]
    | RouterOutputs["request"]["validateDeleteByAdmin"],
> {
  result: { data: { json: T } };
}

/**
 * Configure basic CORS headers
 * You should extend this to match your needs
 */
function setCorsHeaders(res: Response) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Request-Method", "*");
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "*");
}

export function OPTIONS() {
  const response = new Response(null, {
    status: 204,
  });
  setCorsHeaders(response);
  return response;
}

const handler = auth(async (req) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () =>
      createTRPCContext({
        session: req.auth,
        headers: req.headers,
      }),
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });

  setCorsHeaders(response);

  try {
    if (!response.ok) throw new Error(REQUEST_FAILED_ERROR);

    const _trpcRoute = req.url.match(/.*\/api\/trpc\/(.*)$/)?.[1];
    if (!_trpcRoute) throw new Error(NO_TRPC_ROUTE_ERROR);

    const trpcRoute = _trpcRoute as
      | (typeof updateDataPath)[number]
      | (typeof conditionalDataPath)[number];

    if (![...updateDataPath, ...conditionalDataPath].includes(trpcRoute)) {
      throw new Error(NO_DATA_MODIFICATION_ERROR);
    }

    const clonedResponse = response.clone();

    const payload = await getPayload(clonedResponse, trpcRoute);

    if (payload) {
      console.log("sending data to webhooks", payload);
      after(() => {
        console.log("revalidating path", "/");
        revalidatePath("/");
        void notifyWebhooks(payload);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      ![
        NO_TRPC_ROUTE_ERROR,
        REQUEST_FAILED_ERROR,
        NO_DATA_MODIFICATION_ERROR,
      ].includes(message)
    ) {
      console.error("Error evaluating response for revalidation", message);
    }
  }
  return response;
});

export { handler as GET, handler as POST };

const getPayload = async (
  response: Response,
  trpcRoute:
    | (typeof updateDataPath)[number]
    | (typeof conditionalDataPath)[number],
): Promise<
  | {
      eventId?: number;
      locationId?: number;
      orgId?: number;
      action: "map.updated" | "map.created" | "map.deleted";
    }
  | undefined
> => {
  const clonedResponse = response.clone();
  let payload:
    | {
        eventId?: number;
        locationId?: number;
        orgId?: number;
        action: "map.updated" | "map.created" | "map.deleted";
      }
    | undefined = undefined;

  switch (trpcRoute) {
    case "event.crupdate":
      payload = {
        eventId: (
          (await clonedResponse.json()) as TrpcResponse<
            RouterOutputs["event"]["crupdate"]
          >
        )?.result?.data?.json?.id,
        action: "map.updated",
      };
      break;
    case "event.delete":
      payload = {
        eventId: (
          (await clonedResponse.json()) as TrpcResponse<
            RouterOutputs["event"]["delete"]
          >
        )?.result?.data?.json?.eventId,
        action: "map.deleted",
      };
      break;
    case "location.crupdate":
      payload = {
        locationId: (
          (await clonedResponse.json()) as TrpcResponse<
            RouterOutputs["location"]["crupdate"]
          >
        )?.result?.data?.json?.id,
        action: "map.updated",
      };
      break;
    case "location.delete":
      payload = {
        locationId: (
          (await clonedResponse.json()) as TrpcResponse<
            RouterOutputs["location"]["delete"]
          >
        )?.result?.data?.json?.locationId,
        action: "map.deleted",
      };
      break;
    case "org.crupdate":
      payload = {
        orgId: (
          (await clonedResponse.json()) as TrpcResponse<
            RouterOutputs["org"]["crupdate"]
          >
        )?.result?.data?.json?.id,
        action: "map.updated",
      };
      break;
    case "org.delete":
      payload = {
        orgId: (
          (await clonedResponse.json()) as TrpcResponse<
            RouterOutputs["org"]["delete"]
          >
        )?.result?.data?.json?.orgId,
        action: "map.deleted",
      };
      break;
    case "request.submitUpdateRequest":
      const requestSubmitUpdateRequestJson =
        (await clonedResponse.json()) as TrpcResponse<
          RouterOutputs["request"]["submitUpdateRequest"]
        >;
      payload = {
        action: "map.updated",
        eventId:
          requestSubmitUpdateRequestJson?.result?.data?.json?.updateRequest
            .eventId ?? undefined,
        locationId:
          requestSubmitUpdateRequestJson?.result?.data?.json?.updateRequest
            .locationId ?? undefined,
        orgId:
          requestSubmitUpdateRequestJson?.result?.data?.json?.updateRequest
            .regionId ?? undefined,
      };
      break;
    case "request.submitDeleteRequest":
      const requestSubmitDeleteRequestJson =
        (await clonedResponse.json()) as TrpcResponse<
          RouterOutputs["request"]["submitDeleteRequest"]
        >;
      payload = {
        action: "map.deleted",
        eventId:
          requestSubmitDeleteRequestJson?.result?.data?.json?.deleteRequest
            ?.eventId ?? undefined,
        locationId:
          requestSubmitDeleteRequestJson?.result?.data?.json?.deleteRequest
            .locationId ?? undefined,
        orgId:
          requestSubmitDeleteRequestJson?.result?.data?.json?.deleteRequest
            .regionId ?? undefined,
      };
      break;
    case "request.validateSubmissionByAdmin":
      const requestValidateSubmissionByAdminJson =
        (await clonedResponse.json()) as TrpcResponse<
          RouterOutputs["request"]["validateSubmissionByAdmin"]
        >;
      payload = {
        action: "map.updated",
        eventId:
          requestValidateSubmissionByAdminJson?.result?.data?.json
            ?.updateRequest?.eventId ?? undefined,
      };
      break;
  }
  return payload;
};
