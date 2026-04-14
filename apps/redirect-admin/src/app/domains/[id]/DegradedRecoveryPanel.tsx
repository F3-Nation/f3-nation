"use client";

/**
 * Client-side panel rendered on the domain detail page when a row is
 * `degraded`. Shows the reconciler-error diff, the recovery target,
 * a runbook link, and the "Retry reconciliation" button gated on
 * drift acknowledgment.
 *
 * The "acknowledge drift" form is rendered inline for platform
 * super-admins so the flow can happen on a single page — a non-super
 * admin sees the greyed-out retry button with the explanatory note.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import type {
  ReconcilerError,
  RecoverableTargetState,
} from "@/lib/state-presenter";

const RUNBOOK_BASE =
  "https://github.com/F3-Nation/f3-redirect/blob/main/docs/runbooks/reconciler-drift.md";

interface Props {
  domainId: string;
  reconcilerError: ReconcilerError | null;
  driftAcknowledged: boolean;
  targetState: RecoverableTargetState | null;
  isSuperAdmin: boolean;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "submitting"; action: "acknowledge" | "retry" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export function DegradedRecoveryPanel({
  domainId,
  reconcilerError,
  driftAcknowledged,
  targetState,
  isSuperAdmin,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [justification, setJustification] = useState("");
  const [copied, setCopied] = useState(false);

  const retryDisabled =
    !driftAcknowledged || !targetState || state.kind === "submitting";

  const driftKind = reconcilerError?.drift_kind ?? "unknown";
  const runbookAnchor = runbookAnchorFor(driftKind);

  const copyRunId = async () => {
    const id = reconcilerError?.reconciler_run_id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const acknowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ kind: "submitting", action: "acknowledge" });
    try {
      const res = await fetch("/api/admins/drift-acknowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domainId, justification }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setState({
          kind: "error",
          message: body.error ?? `acknowledge failed (${res.status})`,
        });
        return;
      }
      setState({
        kind: "success",
        message: "Drift acknowledged — you can now retry reconciliation.",
      });
      router.refresh();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const retry = async () => {
    setState({ kind: "submitting", action: "retry" });
    try {
      const res = await fetch(`/api/domains/${domainId}/retry-reconciliation`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setState({
          kind: "error",
          message: body.error ?? `retry failed (${res.status})`,
        });
        return;
      }
      setState({
        kind: "success",
        message:
          "Retry submitted — reconciler will pick this row up next cycle.",
      });
      router.refresh();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-red-300 bg-red-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-red-900">
            Reconciler drift detected
          </h3>
          <p className="text-xs text-red-900">
            drift_kind: <span className="font-mono">{driftKind}</span>
            {reconcilerError?.resource_name ? (
              <>
                {" "}
                · resource:{" "}
                <span className="font-mono">
                  {reconcilerError.resource_name}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {targetState ? (
          <span className="rounded bg-red-900 px-3 py-1 text-xs text-white">
            recovers to {targetState}
          </span>
        ) : (
          <span className="rounded bg-muted px-3 py-1 text-xs">
            no recoverable target
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SpecBlock
          label="Observed spec"
          payload={reconcilerError?.observed_spec}
        />
        <SpecBlock
          label="Expected spec"
          payload={reconcilerError?.expected_spec}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        {reconcilerError?.detected_at ? (
          <span>
            detected at{" "}
            <span className="font-mono">{reconcilerError.detected_at}</span>
          </span>
        ) : null}
        {reconcilerError?.reconciler_run_id ? (
          <button
            type="button"
            onClick={copyRunId}
            className="rounded border border-red-900 bg-white px-2 py-1"
          >
            copy run id {copied ? "✓" : ""}
          </button>
        ) : null}
        <a
          href={`${RUNBOOK_BASE}${runbookAnchor}`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          runbook ↗
        </a>
      </div>

      <div className="rounded border border-red-200 bg-white p-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={retry}
            disabled={retryDisabled}
            className="rounded bg-red-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            Retry reconciliation
          </button>
          <span className="text-xs text-red-900">
            {driftAcknowledged
              ? "Drift acknowledged."
              : "Button disabled until a super-admin acknowledges the drift."}
          </span>
        </div>
      </div>

      {isSuperAdmin && !driftAcknowledged ? (
        <form onSubmit={acknowledge} className="space-y-2">
          <label
            htmlFor="drift-ack-justification"
            className="block text-xs font-semibold text-red-900"
          >
            Platform super-admin acknowledgment
          </label>
          <textarea
            id="drift-ack-justification"
            className="h-20 w-full rounded border px-2 py-1 text-sm"
            placeholder="Describe what you investigated (required, min 10 chars)."
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <button
            type="submit"
            disabled={
              justification.trim().length < 10 || state.kind === "submitting"
            }
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          >
            Acknowledge drift
          </button>
        </form>
      ) : null}

      {state.kind === "error" ? (
        <p className="text-xs text-red-900">Error: {state.message}</p>
      ) : null}
      {state.kind === "success" ? (
        <p className="text-xs text-emerald-900">{state.message}</p>
      ) : null}
    </div>
  );
}

function SpecBlock({ label, payload }: { label: string; payload: unknown }) {
  return (
    <div>
      <div className="text-xs font-semibold text-red-900">{label}</div>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-2 text-xs">
        {payload === undefined || payload === null
          ? "—"
          : JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

function runbookAnchorFor(driftKind: string): string {
  switch (driftKind) {
    case "spec_mismatch":
      return "#spec-mismatch";
    case "orphan_resource":
      return "#orphan-resource";
    case "unexpected_state":
      return "#unexpected-state";
    default:
      return "";
  }
}
