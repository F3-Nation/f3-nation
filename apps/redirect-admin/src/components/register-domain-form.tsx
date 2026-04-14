"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OrgOption {
  id: number;
  name: string;
}

interface RegisterDomainFormProps {
  orgs: OrgOption[];
  initialOrgId?: number;
}

interface RegistrationSuccess {
  id: string;
  hostname: string;
  hostname_role: "apex" | "stats";
  lifecycle_state: string;
  dns_challenge: { name: string; value: string; type: string };
  reused_existing_authorization: boolean;
}

export function RegisterDomainForm({
  orgs,
  initialOrgId,
}: RegisterDomainFormProps) {
  const router = useRouter();
  const [orgId, setOrgId] = useState<number | undefined>(initialOrgId);
  const [hostname, setHostname] = useState("");
  const [hostnameRole, setHostnameRole] = useState<"apex" | "stats">("apex");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<RegistrationSuccess | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) {
      setError("Please select an org.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/domains/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          hostname,
          hostname_role: hostnameRole,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(body.error ?? `HTTP ${res.status}`));
        return;
      }
      setSuccess(body as unknown as RegistrationSuccess);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-6">
        <h3 className="text-lg font-semibold text-emerald-900">
          Registered — add this CNAME to your DNS
        </h3>
        <p className="text-sm text-muted-foreground">
          Your hostname{" "}
          <code className="rounded bg-muted px-1">{success.hostname}</code> is
          queued. Add the CNAME record below so Google can validate and issue
          your TLS certificate.
        </p>
        <dl className="grid grid-cols-[max-content_1fr] gap-2 text-sm">
          <dt className="font-medium">Record type</dt>
          <dd>
            <code className="rounded bg-muted px-1">CNAME</code>
          </dd>
          <dt className="font-medium">Name</dt>
          <dd>
            <code className="rounded bg-muted px-1 break-all">
              {success.dns_challenge.name}
            </code>
          </dd>
          <dt className="font-medium">Value</dt>
          <dd>
            <code className="rounded bg-muted px-1 break-all">
              {success.dns_challenge.value}
            </code>
          </dd>
        </dl>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => router.push(`/domains`)}
            className="rounded border px-4 py-2 text-sm hover:bg-muted"
          >
            Go to domain list
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border bg-card p-6"
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">Org</span>
        <select
          className="w-full rounded border px-3 py-2"
          value={orgId ?? ""}
          onChange={(e) => setOrgId(Number(e.target.value))}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} (#{o.id})
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Hostname</span>
        <input
          type="text"
          placeholder="f3muletown.com or stats.f3region.org"
          className="w-full rounded border px-3 py-2"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          required
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Hostname role</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="hostname_role"
            value="apex"
            checked={hostnameRole === "apex"}
            onChange={() => setHostnameRole("apex")}
          />
          Apex — my region&apos;s main domain
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="hostname_role"
            value="stats"
            checked={hostnameRole === "stats"}
            onChange={() => setHostnameRole("stats")}
          />
          Stats — a subdomain for regional stats / dashboards
        </label>
      </fieldset>

      {error ? (
        <p className="text-sm text-destructive">Error: {error}</p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Registering…" : "Register domain"}
      </button>
    </form>
  );
}
