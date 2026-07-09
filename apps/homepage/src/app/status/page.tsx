import { fetchContractStatus, STATUS_TARGETS } from "@/lib/status";

function statusTone(status: "ok" | "degraded" | "down") {
  switch (status) {
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "degraded":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "down":
      return "border-red-200 bg-red-50 text-red-900";
  }
}

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
            <section
              key={result.target.id}
              className={`rounded-lg border p-5 shadow-xs ${statusTone(result.status)}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    {result.target.label}
                  </h2>
                  <p className="text-sm opacity-80">{result.target.url}</p>
                </div>
                <span className="rounded-full border border-current px-3 py-1 text-sm font-semibold tracking-wide uppercase">
                  {result.status}
                </span>
              </div>

              {result.ok ? (
                <div className="mt-4 space-y-2 text-sm">
                  <p>Contract version: {result.data.contractVersion}</p>
                  <p>Last updated: {result.data.timestamp}</p>
                  <ul className="space-y-2 pt-2">
                    {result.data.checks.map((check) => (
                      <li
                        key={check.id}
                        className="rounded border border-current/15 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{check.id}</span>
                          <span className="text-xs tracking-wide uppercase">
                            {check.status}
                          </span>
                        </div>
                        {check.message && (
                          <p className="mt-1 text-xs opacity-80">
                            {check.message}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-4 space-y-1 text-sm">
                  <p className="font-medium">Reason: {result.reason}</p>
                  <p className="opacity-80">Source: contract monitor</p>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
