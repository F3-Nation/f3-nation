import { useFormContext } from "react-hook-form";

import type { DeleteEventType } from "@acme/validators/request-schemas";

import { orpc, useQuery } from "~/orpc/react";

export const DeleteEventForm = <_T extends DeleteEventType>() => {
  const form = useFormContext<DeleteEventType>();
  const originalEventId = form.watch("originalEventId");
  const { data: event } = useQuery(
    orpc.event.byId.queryOptions({
      input: { id: originalEventId },
      enabled: !!originalEventId,
    }),
  );
  return (
    <div className="my-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
      <div className="flex flex-col gap-4">
        {/* Event Details Section */}
        <div className="mb-3 flex items-center space-x-3 border-b border-red-100 pb-3 dark:border-red-800">
          <div className="flex-shrink-0">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-800">
              <svg
                className="h-6 w-6 text-red-400 dark:text-red-300"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"
                />
              </svg>
            </span>
          </div>
          <div>
            <div className="text-lg font-semibold text-red-800 dark:text-red-200">
              {event?.name ? (
                event.name
              ) : (
                <span className="italic text-red-400">
                  Event name loading...
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Event ID: <span className="font-mono">{originalEventId}</span>
            </div>
          </div>
        </div>
        {/* Warning Section */}
        <div className="ml-1">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
            Attention Required
          </h3>
          <div className="mt-2 text-sm text-red-700 dark:text-red-300">
            <p>
              You are about to request deletion of an event.
              <br />
              This action cannot be undone. Please confirm you want to proceed
              with this deletion request.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
