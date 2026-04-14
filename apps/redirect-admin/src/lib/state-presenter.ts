/**
 * Pure presentation layer for `region_custom_domains.lifecycle_state`.
 *
 * This is a 100%-unit-testable function. It maps the 11 lifecycle states
 * (R5 Decision 7) to user-facing strings plus an optional call-to-action.
 * Route handlers and UI components call this — never hard-code state
 * strings in JSX.
 *
 * When the `reconcilerError` payload is populated on the row, the
 * presenter folds it in so the user sees WHY their domain is degraded,
 * not just THAT it is.
 */

// Mirrors packages/redirect-platform-db/src/schema.ts `lifecycleState` enum.
export type LifecycleState =
  | "pending"
  | "awaiting_dns_challenge"
  | "validating"
  | "provisioning_cert"
  | "awaiting_probe"
  | "awaiting_cutover"
  | "active"
  | "degraded"
  | "tombstoned"
  | "quarantined"
  | "released";

export interface ReconcilerError {
  drift_kind?: string;
  resource_type?: string;
  resource_name?: string;
  recoverable_from?: string[];
  detected_at?: string;
  reconciler_run_id?: string;
}

export type PresenterVariant = "info" | "warning" | "error" | "success";

export interface PresenterActionable {
  /** Short label for the primary button the user should click. */
  button: string;
  /** Either a same-app route (`/…`) or an external absolute URL. */
  action: string;
}

export interface PresentedLifecycle {
  state: LifecycleState;
  label: string;
  description: string;
  variant: PresenterVariant;
  actionable?: PresenterActionable;
}

/**
 * Map a lifecycle state (and optional reconciler error payload) to the
 * user-facing view model. Pure — no I/O, no globals.
 */
export function presentLifecycleState(
  state: LifecycleState,
  error?: ReconcilerError | null,
): PresentedLifecycle {
  switch (state) {
    case "pending":
      return {
        state,
        label: "Pending",
        description:
          "Your registration was accepted and is queued for DNS challenge setup. This usually completes within a minute — refresh to check progress.",
        variant: "info",
      };

    case "awaiting_dns_challenge":
      return {
        state,
        label: "Awaiting DNS Challenge",
        description:
          "We created a DNS challenge record for your hostname. Add the CNAME shown below to your DNS zone so we can issue a TLS certificate for you.",
        variant: "warning",
        actionable: {
          button: "View DNS Records",
          action: "details",
        },
      };

    case "validating":
      return {
        state,
        label: "Validating DNS",
        description:
          "Your CNAME record is being validated by Google Certificate Manager. This normally completes within 10–15 minutes.",
        variant: "info",
      };

    case "provisioning_cert":
      return {
        state,
        label: "Issuing Certificate",
        description:
          "DNS validation succeeded. A TLS certificate is being issued for your hostname — no action needed on your side.",
        variant: "info",
      };

    case "awaiting_probe":
      return {
        state,
        label: "Awaiting Health Probe",
        description:
          "Your certificate is attached to the load balancer. We're waiting for multi-region health probes to confirm the endpoint is reachable before marking this safe to cut over.",
        variant: "info",
      };

    case "awaiting_cutover":
      return {
        state,
        label: "Safe to Cut Over",
        description:
          "All health probes succeeded. You can now update your apex DNS record to point at the F3 redirect load balancer — see the details view for the exact A record value.",
        variant: "success",
        actionable: {
          button: "View Cutover Instructions",
          action: "details",
        },
      };

    case "active":
      return {
        state,
        label: "Active",
        description:
          "Your hostname is live and serving redirects. Nothing more to do — we will renew the certificate automatically.",
        variant: "success",
      };

    case "degraded": {
      const driftKind = error?.drift_kind ?? "unknown";
      const resource =
        error?.resource_name ?? error?.resource_type ?? "a GCP resource";
      return {
        state,
        label: "Degraded — Attention Needed",
        description: `The reconciler detected drift on ${resource} (${driftKind}). Redirects may still be serving from the edge cache; follow the recovery steps to restore parity.`,
        variant: "error",
        actionable: {
          button: "View Recovery Steps",
          action: "details",
        },
      };
    }

    case "tombstoned":
      return {
        state,
        label: "Tombstoned",
        description:
          "You marked this domain for removal. The reconciler is tearing down its GCP resources and will release the hostname for reuse shortly.",
        variant: "warning",
      };

    case "quarantined":
      return {
        state,
        label: "Quarantined",
        description:
          "This hostname is quarantined (a platform admin action). It cannot be re-registered until the quarantine lifts — contact platform support if this is unexpected.",
        variant: "error",
      };

    case "released":
      return {
        state,
        label: "Released",
        description:
          "This domain has been fully released. The hostname is free to re-register by any org whose binding is verified.",
        variant: "info",
      };
  }
}
