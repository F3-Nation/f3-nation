/**
 * Binding verification page (F3R5_013, Decision 9).
 *
 * Flow:
 *   1. Require SSO session.
 *   2. Load the `org_region_bindings` row for the requested org.
 *   3. If already `verified`, redirect to `/` with a flash query param.
 *   4. Call the internal validator (live, every render) to drive the
 *      three evidence panels.
 *   5. Render `<BindingVerificationScreen />` with the response.
 *
 * Intentionally uses Next's `notFound()` / `forbidden` semantics via
 * explicit JSX error states rather than throwing — matches the style
 * of the existing landing page.
 */

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { orgRegionBindings } from "@acme/redirect-platform-db";
import type { OrgRegionBinding } from "@acme/redirect-platform-db";

import { getSessionUser } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { checkUserRoleOnOrg } from "@/lib/services/user-orgs";
import { getValidatorClient } from "@/lib/validator-factory";
import {
  CallerNotAuthorizedError,
  OrgNotFoundError,
  TripleMismatchError,
  ValidatorUnavailableError,
} from "@/lib/validator-client";
import type {
  ValidatorResponseBody,
  ValidatorTripleMismatchDetail,
} from "@/lib/validator-client";

import { BindingVerificationScreen } from "./BindingVerificationScreen";

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export const dynamic = "force-dynamic";

export default async function VerifyBindingPage({ params }: PageProps) {
  const { orgId: orgIdRaw } = await params;
  const orgId = Number.parseInt(orgIdRaw, 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return <ErrorPanel title="Invalid org id" body={`orgId=${orgIdRaw}`} />;
  }

  const user = await getSessionUser();
  if (!user) {
    redirect(`/?redirect=${encodeURIComponent(`/bindings/${orgId}/verify`)}`);
  }

  const { db } = getRedirectAdminDb();
  const { db: supabase } = getSupabaseDb();

  // Role gate: only admin/editor on the org can open this page.
  const authorized = await checkUserRoleOnOrg(supabase, {
    userId: user.userId,
    orgId,
  });
  if (!authorized) {
    return (
      <ErrorPanel
        title="Forbidden"
        body={`You don't have admin or editor on org #${orgId}.`}
      />
    );
  }

  const bindingRows = await db
    .select()
    .from(orgRegionBindings)
    .where(eq(orgRegionBindings.orgId, orgId));
  const binding = bindingRows[0] as OrgRegionBinding | undefined;
  if (!binding) {
    return (
      <ErrorPanel
        title="No binding found"
        body={`Org #${orgId} has no org_region_bindings row. Contact platform support.`}
      />
    );
  }

  if (binding.verificationState === "verified") {
    redirect("/?flash=already_verified");
  }

  const isRevoked = binding.verificationState === "revoked";

  // Call the validator. Typed-error branching for user-visible states.
  let validator: ValidatorResponseBody | null = null;
  let validatorError:
    | { kind: "unavailable"; message: string }
    | { kind: "triple_mismatch"; mismatches: ValidatorTripleMismatchDetail[] }
    | { kind: "forbidden" }
    | { kind: "not_found" }
    | null = null;

  try {
    const client = getValidatorClient();
    validator = await client.validate({
      orgId: binding.orgId,
      paxVaultRegionId: binding.paxVaultRegionId,
      regionSlug: binding.regionSlug,
      callingUserId: user.userId,
    });
  } catch (err) {
    if (err instanceof ValidatorUnavailableError) {
      validatorError = { kind: "unavailable", message: err.message };
    } else if (err instanceof TripleMismatchError) {
      validatorError = { kind: "triple_mismatch", mismatches: err.mismatches };
    } else if (err instanceof CallerNotAuthorizedError) {
      validatorError = { kind: "forbidden" };
    } else if (err instanceof OrgNotFoundError) {
      validatorError = { kind: "not_found" };
    } else {
      validatorError = {
        kind: "unavailable",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (validatorError?.kind === "forbidden") {
    return (
      <ErrorPanel
        title="Forbidden"
        body="The validator reports you're not authorized on this org."
      />
    );
  }
  if (validatorError?.kind === "not_found") {
    return (
      <ErrorPanel
        title="Org not found"
        body={`Org #${orgId} does not exist in the f3-nation directory.`}
      />
    );
  }
  if (validatorError?.kind === "unavailable") {
    return (
      <ErrorPanel
        title="Validator unavailable"
        variant="warning"
        body={`We can't reach the region-binding validator right now. Please try again in a few minutes. (${validatorError.message})`}
      />
    );
  }
  if (validatorError?.kind === "triple_mismatch" || !validator) {
    return (
      <ErrorPanel
        title="Sources disagree"
        variant="warning"
        body="The validator reports that the org, pax-vault region, and f3-region-pages slug don't agree. Contact platform support before proceeding."
      >
        {validatorError?.kind === "triple_mismatch" ? (
          <pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(validatorError.mismatches, null, 2)}
          </pre>
        ) : null}
      </ErrorPanel>
    );
  }

  return (
    <BindingVerificationScreen
      orgId={orgId}
      binding={{
        source: binding.source,
        boundAt: binding.boundAt,
        regionSlug: binding.regionSlug,
        regionName: binding.regionName,
      }}
      validator={validator}
      wasRevoked={isRevoked}
    />
  );
}

interface ErrorPanelProps {
  title: string;
  body: string;
  variant?: "error" | "warning";
  children?: React.ReactNode;
}

function ErrorPanel({
  title,
  body,
  variant = "error",
  children,
}: ErrorPanelProps) {
  const bg =
    variant === "warning"
      ? "border-yellow-300 bg-yellow-50"
      : "border-red-300 bg-red-50";
  const text = variant === "warning" ? "text-yellow-900" : "text-red-900";
  return (
    <div className={`rounded-lg border p-6 ${bg}`}>
      <h2 className={`text-lg font-semibold ${text}`}>{title}</h2>
      <p className={`mt-2 text-sm ${text}`}>{body}</p>
      {children}
    </div>
  );
}
