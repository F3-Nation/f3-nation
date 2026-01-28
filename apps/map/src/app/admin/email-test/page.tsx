"use client";

import Layout from "../admin-layout";
import { EmailTestForm } from "./email-test-form";

const EmailTestPage = () => {
  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Email Template Test</h1>
          <p className="text-sm text-muted-foreground">
            Test email templates by sending them to any address. Nation admin
            only.
          </p>
        </div>
        <EmailTestForm />
      </div>
    </Layout>
  );
};

export default EmailTestPage;
