import { fetchContractStatus } from "@/lib/status";
import { StatusCard } from "@/app/status/status-card";
import { STATUS_TARGETS } from "@/status-targets";

export default async function StatusPage() {
  const results = await Promise.all(
    STATUS_TARGETS.map((target) => fetchContractStatus(target)),
  );

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
            Service Status
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Contract-validated health checks for configured F3 services.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {results.map((result) => (
            <StatusCard key={result.target.id} result={result} />
          ))}
        </div>
      </div>
    </main>
  );
}
