import { Badge } from "@acme/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { Separator } from "@acme/ui/separator";
import type { StatusResult } from "@/lib/status";

function badgeVariantForStatus(status: "ok" | "degraded" | "down") {
  switch (status) {
    case "ok":
      return "default" as const;
    case "degraded":
      return "secondary" as const;
    case "down":
      return "destructive" as const;
  }
}

export function StatusCard({ result }: { result: StatusResult }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">{result.target.label}</CardTitle>
            <CardDescription>{result.target.url}</CardDescription>
            <p className="text-xs text-muted-foreground">
              Monitor: {result.source === "contract" ? "Contract" : "External"}
            </p>
          </div>
          <Badge variant={badgeVariantForStatus(result.status)}>
            Status: {result.status.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {result.ok && result.source === "contract" ? (
          <>
            <p>
              <span className="font-medium">Contract version:</span>{" "}
              {result.data.contractVersion}
            </p>
            <p>
              <span className="font-medium">Last updated:</span>{" "}
              {result.data.timestamp}
            </p>
            <Separator />
            <div className="space-y-2">
              {result.data.checks.map(
                (check: (typeof result.data.checks)[number]) => (
                  <div key={check.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{check.id}</span>
                      <Badge
                        variant={badgeVariantForStatus(check.status)}
                        className="text-[10px]"
                      >
                        {check.status.toUpperCase()}
                      </Badge>
                    </div>
                    {check.message ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {check.message}
                      </p>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          </>
        ) : result.ok && result.source === "external" ? (
          <div className="space-y-1">
            <p>
              <span className="font-medium">Provider:</span>{" "}
              {result.data.provider}
            </p>
            <p>
              <span className="font-medium">Provider status:</span>{" "}
              {result.data.providerStatus}
            </p>
            <p>
              <span className="font-medium">Active incidents:</span>{" "}
              {result.data.incidents}
            </p>
            <p>
              <span className="font-medium">Last updated:</span>{" "}
              {result.data.timestamp}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <p>
              <span className="font-medium">Reason:</span> {result.reason}
            </p>
            <p className="text-muted-foreground">
              Source: {result.source} monitor
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
