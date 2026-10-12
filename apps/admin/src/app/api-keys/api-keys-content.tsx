"use client";

import { Spinner } from "@acme/ui/spinner";

import { useAuth } from "~/utils/hooks/use-auth";
import { ApiKeysTable } from "./api-keys-table";
import { CreateApiKeyButton } from "./create-api-key-button";

export const ApiKeysContent = () => {
  const { isAdmin, status } = useAuth();

  if (status === "loading") {
    return <Spinner text="Loading session" />;
  }

  if (status !== "authenticated" || !isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Only admins can manage API keys.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="hidden text-2xl font-semibold lg:block">API Keys</h1>
          <p className="text-sm text-muted-foreground">
            Manage programmatic access for trusted integrations.
          </p>
        </div>
        <div className="ml-auto">
          <CreateApiKeyButton />
        </div>
      </div>
      <ApiKeysTable />
    </div>
  );
};
