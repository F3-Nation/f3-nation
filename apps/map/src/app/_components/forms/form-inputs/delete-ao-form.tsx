import { useFormContext } from "react-hook-form";

import type { DeleteAOType } from "@acme/validators/request-schemas";

import { api } from "~/trpc/react";

export const DeleteAoForm = <_T extends DeleteAOType>() => {
  const form = useFormContext<DeleteAOType>();
  const originalAoId = form.watch("originalAoId");
  const { data: result } = api.location.getAOById.useQuery(
    { id: originalAoId },
    { enabled: !!originalAoId },
  );
  return (
    <div className="my-6 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
      <div className="flex flex-col gap-4">
        {/* AO Details Section */}
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
              {result?.ao?.name ? (
                result.ao.name
              ) : (
                <span className="italic text-red-400">AO name loading...</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              AO ID: <span className="font-mono">{originalAoId}</span>
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
              You are about to request deletion of an AO.
              <br />
              <span className="font-semibold">
                This will delete{" "}
                <span className="underline">
                  {result?.ao?.name ? result.ao.name : "this AO"}
                </span>
                , all its workouts, and possibly the location if no other events
                exist there.
              </span>
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
