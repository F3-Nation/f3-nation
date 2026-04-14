"use client";

/**
 * Client component for the Decision 9 binding verification screen.
 *
 * Renders:
 *   - Header with org name, bind-time timestamp, and source provenance
 *   - A re-verification banner when the binding was previously revoked
 *   - Three evidence panels (org / pax-vault / f3-region-pages)
 *   - Cross-check banner (green when triple_matches, red otherwise)
 *   - Three-button action row with a type-the-org-name confirmation
 *     dialog on the primary action
 *
 * The validator response surface is smaller than the full Decision 9
 * wire-up contemplates (no PAX count / beatdown / thumbnail yet — those
 * live in a future validator extension). This component surfaces the
 * fields the validator currently ships and renders graceful fallbacks
 * for the missing ones.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  ValidatorResponseBody,
  ValidatorTripleMismatchDetail,
} from "@/lib/validator-client";

interface BindingMeta {
  source: string;
  boundAt: string;
  regionSlug: string;
  regionName: string;
}

export interface BindingVerificationScreenProps {
  orgId: number;
  binding: BindingMeta;
  validator: ValidatorResponseBody;
  wasRevoked: boolean;
}

type ActionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function BindingVerificationScreen(
  props: BindingVerificationScreenProps,
) {
  const { orgId, binding, validator, wasRevoked } = props;
  const router = useRouter();
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedName, setTypedName] = useState("");

  const tripleMatches = validator.cross_check.triple_matches;
  const mismatches: ValidatorTripleMismatchDetail[] = useMemo(() => {
    // The 200 response body doesn't carry mismatches (those are in the
    // 422 error path), but the UI can still surface the match_strategy
    // + raw cross_check payload when triple_matches === false.
    return [];
  }, []);

  const sourceLabel = prettySource(binding.source);

  const submit = async (action: "confirm" | "report_mismatch") => {
    setActionState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/bindings/${orgId}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setActionState({
          kind: "error",
          message: body.error ?? `request failed with status ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as { redirect?: string };
      router.push(body.redirect ?? "/");
      router.refresh();
    } catch (err) {
      setActionState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onConfirmClick = () => {
    setConfirmOpen(true);
  };

  const onConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typedName.trim() !== validator.org.name.trim()) return;
    setConfirmOpen(false);
    void submit("confirm");
  };

  const onMaybeLater = () => {
    router.push("/");
  };

  return (
    <div className="space-y-6">
      <header className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              Verify binding — {validator.org.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              org #{orgId} · bound {formatTimestamp(binding.boundAt)} · source{" "}
              <span className="font-mono">{sourceLabel}</span>
            </p>
          </div>
          <div className="rounded bg-muted px-3 py-1 text-xs">
            match strategy:{" "}
            <span className="font-mono">
              {validator.cross_check.match_strategy}
            </span>
          </div>
        </div>
        {wasRevoked ? (
          <div className="mt-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
            This binding was previously <strong>revoked</strong>. You are
            re-verifying it. Double-check the evidence below before confirming.
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <EvidencePanel title="F3 Nation org">
          <div className="text-sm">
            <div className="font-medium">{validator.org.name}</div>
            <div className="text-xs text-muted-foreground">
              last modified {formatTimestamp(validator.org.last_modified)}
            </div>
          </div>
          <Badge>
            You are{" "}
            <span className="font-mono">
              {validator.org.caller_roles[0] ?? "—"}
            </span>{" "}
            on this org
          </Badge>
          <div className="text-xs text-muted-foreground">
            {Math.max(0, validator.org.admin_count - 1)} other admins
          </div>
        </EvidencePanel>

        <EvidencePanel title="Pax-Vault region">
          <div className="text-2xl font-semibold">
            {binding.regionName || validator.pax_vault.region_name}
          </div>
          <div className="text-xs text-muted-foreground">
            region_id:{" "}
            <span className="font-mono">{validator.pax_vault.region_id}</span>
          </div>
          <div className="mt-2 rounded border border-dashed border-muted-foreground/40 p-3 text-xs text-muted-foreground">
            Extended stats (PAX count, most recent beatdown, region thumbnail)
            will land alongside a pax-vault validator extension.
          </div>
        </EvidencePanel>

        <EvidencePanel title="F3 Region Pages">
          <div className="text-sm">
            region slug:{" "}
            <span className="font-mono">{validator.f3_region_pages.slug}</span>
          </div>
          <a
            className="text-sm text-primary underline"
            href={`https://regions.f3nation.com/${validator.f3_region_pages.slug}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open on regions.f3nation.com ↗
          </a>
          <IframePreview slug={validator.f3_region_pages.slug} />
        </EvidencePanel>
      </div>

      <CrossCheckBanner
        tripleMatches={tripleMatches}
        matchStrategy={validator.cross_check.match_strategy}
        mismatches={mismatches}
      />

      <div className="rounded-lg border bg-card p-5">
        <h3 className="text-base font-semibold">Do the three sources agree?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Verifying this binding unlocks self-serve custom domain registration
          for this org. Mistakes here cause redirects to the wrong region, so
          pick carefully.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onConfirmClick}
            disabled={!tripleMatches || actionState.kind === "submitting"}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Yes, this is correct — mark as verified
          </button>
          <button
            type="button"
            onClick={() => void submit("report_mismatch")}
            disabled={actionState.kind === "submitting"}
            className="rounded border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            This doesn&apos;t look right — open a support request
          </button>
          <button
            type="button"
            onClick={onMaybeLater}
            disabled={actionState.kind === "submitting"}
            className="rounded px-4 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            I&apos;m not sure — come back later
          </button>
        </div>
        {actionState.kind === "error" ? (
          <p className="mt-3 text-sm text-red-700">
            Action failed: {actionState.message}
          </p>
        ) : null}
      </div>

      {confirmOpen ? (
        <ConfirmDialog
          expectedName={validator.org.name}
          typedName={typedName}
          setTypedName={setTypedName}
          onCancel={() => setConfirmOpen(false)}
          onSubmit={onConfirmSubmit}
          submitting={actionState.kind === "submitting"}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EvidencePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-5">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900">
      {children}
    </span>
  );
}

function CrossCheckBanner({
  tripleMatches,
  matchStrategy,
  mismatches,
}: {
  tripleMatches: boolean;
  matchStrategy: string;
  mismatches: ValidatorTripleMismatchDetail[];
}) {
  if (tripleMatches) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <strong>All three sources agree</strong> (matched via{" "}
        <span className="font-mono">{matchStrategy}</span>). You may verify.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
      <strong>Sources disagree.</strong> Verification is disabled until the
      disagreement is resolved. Contact platform support.
      {mismatches.length > 0 ? (
        <pre className="mt-2 overflow-auto rounded bg-white/50 p-2 text-xs">
          {JSON.stringify(mismatches, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function IframePreview({ slug }: { slug: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="h-60 w-full rounded border border-dashed border-muted-foreground/40 p-3 text-xs text-muted-foreground">
        Preview unavailable — the region page couldn&apos;t be embedded
        (X-Frame-Options or network failure).
      </div>
    );
  }
  return (
    <iframe
      title={`region page preview for ${slug}`}
      src={`https://regions.f3nation.com/${slug}`}
      width={600}
      height={400}
      sandbox="allow-same-origin"
      onError={() => setFailed(true)}
      className="h-60 w-full rounded border"
    />
  );
}

function ConfirmDialog({
  expectedName,
  typedName,
  setTypedName,
  onCancel,
  onSubmit,
  submitting,
}: {
  expectedName: string;
  typedName: string;
  setTypedName: (v: string) => void;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
}) {
  const matches = typedName.trim() === expectedName.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-lg bg-card p-6 shadow-lg"
      >
        <h3 className="text-lg font-semibold">Confirm verification</h3>
        <p className="text-sm text-muted-foreground">
          Type the org name exactly to confirm. This cannot be undone without a
          platform admin override.
        </p>
        <div className="rounded bg-muted px-3 py-2 font-mono text-sm">
          {expectedName}
        </div>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="Type org name to confirm"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!matches || submitting}
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Verify binding
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function prettySource(source: string): string {
  switch (source) {
    case "manual_admin":
      return "manual_admin";
    case "auto_backfill":
      return "auto_backfill";
    case "self_service_claim":
      return "self_service_claim";
    default:
      return source;
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
