import Layout from "../admin-layout";
import { ApiKeysTable } from "./api-keys-table";
import { CreateApiKeyButton } from "./create-api-key-button";

const ApiKeysPage = () => {
  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">API Keys</h1>
            <p className="text-sm text-muted-foreground">
              Manage programmatic access for trusted integrations.
            </p>
          </div>
          <CreateApiKeyButton />
        </div>
        <ApiKeysTable />
      </div>
    </Layout>
  );
};

export default ApiKeysPage;
