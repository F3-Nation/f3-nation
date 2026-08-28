import Layout from "../admin-layout";
import { CreateOauthClientButton } from "./create-oauth-client-button";
import { OauthClientsTable } from "./oauth-clients-table";

const OauthClientsPage = () => {
  return (
    <Layout title="OAuth Clients">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="hidden text-2xl font-semibold lg:block">
              OAuth Clients
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage applications registered to sign in through F3 Nation SSO.
            </p>
          </div>
          <div className="ml-auto">
            <CreateOauthClientButton />
          </div>
        </div>
        <OauthClientsTable />
      </div>
    </Layout>
  );
};

export default OauthClientsPage;
