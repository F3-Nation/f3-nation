"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { passkey, signOut } from "@/lib/auth-client";

function PasskeySetup() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ marginTop: "0.6rem" }}>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const res = await passkey.addPasskey();
            setMsg(
              res?.error
                ? `Could not add passkey: ${res.error.message}`
                : "Passkey added — you can use it to sign in next time.",
            );
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Could not add passkey");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Follow your device prompt…" : "Add a passkey"}
      </button>
      <span className="muted" style={{ marginLeft: "0.6rem" }}>
        Optional — sign in faster next time with Touch ID / Face ID / a security
        key.
      </span>
      {msg && (
        <p className="muted" style={{ marginTop: "0.4rem" }}>
          {msg}
        </p>
      )}
    </div>
  );
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  note: string;
  optional?: boolean;
}
interface DomainItem {
  id: string;
  hostname: string;
  destination: string;
  dns: DnsRecord[];
}
interface ApiResponse {
  domain?: DomainItem;
  error?: string;
}

// Stacked, full-width record blocks — no horizontal scroll on mobile.
function DnsRecords({ dns }: { dns: DnsRecord[] }) {
  const sorted = [...dns].sort(
    (a, b) => Number(a.optional) - Number(b.optional),
  );
  return (
    <div>
      {sorted.map((r, i) => (
        <div className="dns-record" key={i}>
          <div className="dns-record-head">
            <span className="badge">{r.type}</span>
            {r.optional ? (
              <span className="muted">recommended</span>
            ) : (
              <strong className="req">required</strong>
            )}
          </div>
          <dl className="dns-kv">
            <dt>Name</dt>
            <dd className="mono">{r.name}</dd>
            <dt>Value</dt>
            <dd className="mono">{r.value}</dd>
          </dl>
          <p className="muted dns-note">{r.note}</p>
        </div>
      ))}
    </div>
  );
}

// Bottom-sheet drawer (native <dialog>) — mobile-friendly, no horizontal scroll.
function DnsSheet({ domain }: { domain: DomainItem }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button onClick={() => ref.current?.showModal()}>View DNS records</button>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop-dismiss only; <dialog> handles Esc/keyboard natively */}
      <dialog
        ref={ref}
        className="sheet"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
      >
        <div className="sheet-body">
          <div className="row">
            <strong className="mono">{domain.hostname}</strong>
            <button onClick={() => ref.current?.close()}>Close</button>
          </div>
          <p className="muted" style={{ margin: "0.3rem 0 0.8rem" }}>
            Add these DNS records at your registrar to activate the redirect:
          </p>
          <DnsRecords dns={domain.dns} />
        </div>
      </dialog>
    </>
  );
}

function DomainCard({
  domain,
  onChange,
  onRemove,
}: {
  domain: DomainItem;
  onChange: (d: DomainItem) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(domain.destination);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/domains/${domain.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: draft }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(data.error ?? "update failed");
        return;
      }
      if (data.domain) onChange(data.domain);
      setEditing(false);
    } catch (e) {
      // fetch rejection or JSON parse error — surface instead of silently
      // leaving the row stuck.
      setError(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/domains/${domain.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiResponse;
        setError(data.error ?? "remove failed");
        return;
      }
      onRemove(domain.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <div className="domain-head">
          <strong className="mono">{domain.hostname}</strong>
          {!editing && (
            <div className="muted mono dest">→ {domain.destination}</div>
          )}
        </div>
        {!editing && (
          <button className="danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ marginTop: "0.6rem" }}>
          <label htmlFor={`dest-${domain.id}`}>Redirect destination</label>
          <input
            id={`dest-${domain.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem" }}>
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(domain.destination);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setEditing(true)}>Edit destination</button>
          <DnsSheet domain={domain} />
        </div>
      )}
      {!editing && error && <p className="error">{error}</p>}
    </div>
  );
}

export function Dashboard({
  initial,
  userEmail,
}: {
  initial: DomainItem[];
  userEmail: string;
}) {
  const router = useRouter();
  const [domains, setDomains] = useState<DomainItem[]>(initial);
  const [hostname, setHostname] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname, destination }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(data.error ?? "failed to register domain");
        return;
      }
      const added = data.domain;
      if (added)
        setDomains((d) =>
          [...d, added].sort((a, b) => a.hostname.localeCompare(b.hostname)),
        );
      setHostname("");
      setDestination("");
    } catch (e) {
      // fetch rejection or JSON parse error — surface instead of silently
      // swallowing it.
      setError(e instanceof Error ? e.message : "failed to register domain");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="row">
        <h1>Your domains</h1>
        <span className="muted">
          {userEmail} ·{" "}
          <button
            type="button"
            className="linkbtn"
            onClick={async () => {
              await signOut();
              router.push("/");
              router.refresh();
            }}
          >
            sign out
          </button>
        </span>
      </div>

      <div className="card">
        <strong>Security</strong>
        <PasskeySetup />
      </div>

      <div className="card">
        <form onSubmit={add}>
          <label htmlFor="hostname">Custom domain</label>
          <input
            id="hostname"
            placeholder="f3muletown.com"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <label htmlFor="destination">Redirect destination</label>
          <input
            id="destination"
            placeholder="https://regions.f3nation.com/muletown"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div style={{ marginTop: "0.9rem" }}>
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Working…" : "Register domain"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </div>

      {domains.length === 0 && (
        <p className="muted">No domains yet — register one above.</p>
      )}

      {domains.map((d) => (
        <DomainCard
          key={d.id}
          domain={d}
          onChange={(u) =>
            setDomains((ds) => ds.map((x) => (x.id === u.id ? u : x)))
          }
          onRemove={(id) => setDomains((ds) => ds.filter((x) => x.id !== id))}
        />
      ))}
    </div>
  );
}
