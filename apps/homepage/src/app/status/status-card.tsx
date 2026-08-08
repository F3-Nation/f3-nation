import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { Separator } from "@acme/ui/separator";
import type { StatusResult } from "@f3nation/health";

function formatTimestamp(iso: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).formatToParts(new Date(iso));
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: "ok" | "degraded" | "down"): string {
  switch (status) {
    case "ok":
      return "border-green-200 bg-green-100 text-green-800";
    case "degraded":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "down":
      return "border-red-200 bg-red-100 text-red-800";
  }
}

export function StatusCard({
  result,
  showDetail = false,
}: {
  result: StatusResult;
  showDetail?: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">{result.target.label}</CardTitle>
            <CardDescription>{result.target.url}</CardDescription>
            {showDetail ? (
              <p className="text-xs text-muted-foreground">
                Monitor:{" "}
                {result.source === "contract" ? "Contract" : "External"}
              </p>
            ) : null}
          </div>
          <Badge variant="outline" className={statusBadgeClass(result.status)}>
            Status: {result.status.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {result.ok && result.source === "contract" ? (
          <>
            {showDetail ? (
              <p>
                <span className="font-medium">Contract version:</span>{" "}
                {result.data.contractVersion}
              </p>
            ) : null}
            <p>
              <span className="font-medium">Last updated:</span>{" "}
              {formatTimestamp(result.data.timestamp)}
            </p>
            <Separator />
            <div className="space-y-2">
              {result.data.checks.map(
                (check: (typeof result.data.checks)[number]) => (
                  <div key={check.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{check.id}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          statusBadgeClass(check.status),
                          "text-[10px]",
                        )}
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
              {formatTimestamp(result.data.timestamp)}
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
