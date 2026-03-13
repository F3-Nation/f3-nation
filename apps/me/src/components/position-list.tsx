"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

interface Position {
  orgId: number;
  orgName?: string;
  positionId: number;
  positionName: string;
}

interface PositionListProps {
  positions: Position[];
}

export function PositionList({
  positions: initialPositions,
}: PositionListProps) {
  const [positions, setPositions] = useState(initialPositions);
  const [removing, setRemoving] = useState<string | null>(null);
  const { toast } = useToast();

  const handleRemove = async (orgId: number, positionId: number) => {
    const key = `${orgId}-${positionId}`;
    setRemoving(key);

    try {
      const res = await fetch("/api/profile/positions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, positionId }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to remove position");
      }

      setPositions((prev) =>
        prev.filter((p) => !(p.orgId === orgId && p.positionId === positionId)),
      );
      toast({
        title: "Position removed",
        description: "Your position assignment has been removed.",
      });
    } catch (err) {
      toast({
        title: "Failed to remove position",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemoving(null);
    }
  };

  if (positions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No positions assigned.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {positions.map((pos) => {
          const key = `${pos.orgId}-${pos.positionId}`;
          return (
            <Badge
              key={key}
              variant="secondary"
              className="flex items-center gap-1.5 pr-1"
            >
              <span>
                {pos.orgName ?? `Org ${pos.orgId}`} — {pos.positionName}
              </span>
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                disabled={removing === key}
                onClick={() => handleRemove(pos.orgId, pos.positionId)}
                aria-label={`Remove ${pos.positionName} position from ${pos.orgName ?? `Org ${pos.orgId}`}`}
              >
                {removing === key ? (
                  <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 2L10 10M2 10L10 2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
            </Badge>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        To add a new position, contact your region admins. Check{" "}
        <a
          href="https://org.f3nation.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          org.f3nation.com
        </a>{" "}
        to find admins.
      </p>
    </div>
  );
}
