import type { LocationAo, LocationDetail, OrgLeaderEntry } from "../_lib/types";

const UNKNOWN_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="16" fill="#f1ead7"/>' +
      '<circle cx="40" cy="30" r="16" fill="#9ca3af"/>' +
      '<path d="M16 70c3-16 17-26 24-26s21 10 24 26" fill="#9ca3af"/>' +
      "</svg>",
  );

function LeaderItem({ entry }: { entry: OrgLeaderEntry }) {
  const avatar = entry.avatarUrl ?? UNKNOWN_AVATAR;
  const name = entry.f3Name ?? "Unknown";
  return (
    <li>
      <div className="flex w-full items-start gap-3 rounded-lg p-1 text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatar}
          alt={name}
          className="h-9 w-9 flex-shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
        <div>
          <div className="text-sm font-semibold text-foreground">
            {entry.title}
          </div>
          <div className="text-xs text-muted-foreground">{name}</div>
        </div>
      </div>
    </li>
  );
}

function AoCard({ ao }: { ao: LocationAo }) {
  const socialLinks: { href: string; label: string; icon: string }[] = [];
  if (ao.website)
    socialLinks.push({ href: ao.website, label: "Website", icon: "🌐" });
  if (ao.twitter)
    socialLinks.push({ href: ao.twitter, label: "X (Twitter)", icon: "𝕏" });
  if (ao.facebook)
    socialLinks.push({ href: ao.facebook, label: "Facebook", icon: "f" });
  if (ao.instagram)
    socialLinks.push({ href: ao.instagram, label: "Instagram", icon: "◻" });

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-left text-base font-bold">
          {ao.name ?? "Unnamed AO"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {ao.eventCount} event{ao.eventCount !== 1 ? "s" : ""}
        </span>
      </div>

      {ao.email && (
        <a
          href={`mailto:${ao.email}`}
          className="mt-1 block text-xs text-primary hover:underline"
        >
          {ao.email}
        </a>
      )}

      {socialLinks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {socialLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs transition hover:bg-primary/20"
            >
              {link.icon}
            </a>
          ))}
        </div>
      )}

      {ao.positions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs tracking-widest text-muted-foreground uppercase">
            Positions
          </div>
          <ul className="space-y-1">
            {ao.positions.map((p, i) => (
              <LeaderItem key={`${i}-${p.positionId ?? p.userId}`} entry={p} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface LocationInfoPanelProps {
  status: "loading" | "loaded" | "error";
  locationId: number;
  detail?: LocationDetail;
}

export function LocationInfoPanel({
  status,
  locationId,
  detail,
}: LocationInfoPanelProps) {
  const title = detail?.locationName ?? `Location ${locationId}`;

  if (status === "loading") {
    return (
      <>
        <div className="text-xl font-bold">{title}</div>
        <div className="text-xs tracking-widest text-muted-foreground uppercase">
          Location
        </div>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <div className="text-xl font-bold">{title}</div>
        <div className="text-sm text-destructive">Failed to load details.</div>
      </>
    );
  }

  return (
    <>
      <div className="text-xl font-bold">{title}</div>
      <div className="text-xs tracking-widest text-muted-foreground uppercase">
        Location
      </div>
      {detail?.aos.length === 0 && (
        <p className="text-sm text-muted-foreground">No active AOs here.</p>
      )}
      {detail?.aos.length ? (
        <div className="space-y-3">
          {detail.aos.map((ao) => (
            <AoCard key={ao.id} ao={ao} />
          ))}
        </div>
      ) : null}
    </>
  );
}
