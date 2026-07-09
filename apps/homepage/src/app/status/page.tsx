import { StatusDashboardClient } from "@/app/status/status-dashboard-client";

export default function StatusPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
            Service Status
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Health checks for services commonly used by F3 PAX and their
            regions. Data updates once a minute.
          </p>
        </div>

        <StatusDashboardClient />
      </div>
    </main>
  );
}
