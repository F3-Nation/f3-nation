"use client";

import { useState } from "react";

import { Badge } from "@acme/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@acme/ui/alert-dialog";
import { useToast } from "@/components/ui/toast";
import { useRemovableList, compositeKey } from "@/hooks/useRemovableList";
import type { UserPosition } from "@/lib/types";

interface PositionListProps {
  positions: UserPosition[];
}

export function PositionList({
  positions: initialPositions,
}: PositionListProps) {
  const { toast } = useToast();
  const [positionToConfirm, setPositionToConfirm] =
    useState<UserPosition | null>(null);
  const {
    items: positions,
    removing,
    handleRemove,
  } = useRemovableList({
    initialItems: initialPositions,
    getKey: (p) => compositeKey(p.orgId, p.positionId),
    endpoint: "/api/profile/positions",
    buildDeleteBody: (p) => ({ orgId: p.orgId, positionId: p.positionId }),
    shouldKeep: (item, removed) =>
      !(item.orgId === removed.orgId && item.positionId === removed.positionId),
    toast,
    successMessage: () => ({
      title: "Position removed",
      description: "Your position assignment has been removed.",
    }),
    failureTitle: "Failed to remove position",
  });

  if (positions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No positions assigned.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {positions.map((pos) => {
          const key = compositeKey(pos.orgId, pos.positionId);
          return (
            <Badge
              key={key}
              variant="secondary"
              className="flex items-center gap-1.5 pr-1"
            >
              <span>
                {pos.orgName} — {pos.positionName}
              </span>
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                disabled={removing !== null}
                onClick={() => setPositionToConfirm(pos)}
                aria-label={`Remove ${pos.positionName} position from ${pos.orgName}`}
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

      <AlertDialog
        open={positionToConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPositionToConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Position?</AlertDialogTitle>
            <AlertDialogDescription>
              {positionToConfirm
                ? `You are about to remove your ${positionToConfirm.positionName} position from ${positionToConfirm.orgName}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removing !== null}
              onClick={() => {
                if (!positionToConfirm || removing !== null) return;
                void handleRemove(positionToConfirm);
                setPositionToConfirm(null);
              }}
            >
              Remove Position
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
