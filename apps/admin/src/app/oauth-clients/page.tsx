import Layout from "../admin-layout";
import { OauthClientsTable } from "./oauth-clients-table";

const OauthClientsPage = () => {
  return (
    <Layout title="OAuth Clients">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="hidden text-2xl font-semibold lg:block">
            OAuth Clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage applications registered to sign in through F3 Nation SSO. New
            clients are registered via apps/auth&apos;s CLI script.
          </p>
        </div>
        <OauthClientsTable />
      </div>
    </Layout>
  );
};

export default OauthClientsPage;
