import Layout from "../admin-layout";
import { ApiKeysTable } from "./api-keys-table";
import { CreateApiKeyButton } from "./create-api-key-button";

const ApiKeysPage = () => {
  return (
    <Layout title="API Keys">
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
    </Layout>
  );
};

export default ApiKeysPage;
