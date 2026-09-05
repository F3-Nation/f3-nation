import type {
  Org,
  OrgDetail,
  OrgLeaderEntry,
  OrgMetrics,
  OrgType,
} from "../_lib/types";

export interface NearestAdminOrg {
  name: string;
  orgType: OrgType;
  adminNames: string[];
}

const UNKNOWN_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="16" fill="#f1ead7"/>' +
      '<circle cx="40" cy="30" r="16" fill="#9ca3af"/>' +
      '<path d="M16 70c3-16 17-26 24-26s21 10 24 26" fill="#9ca3af"/>' +
      "</svg>",
  );

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatDecimal(n: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

interface LeaderItemProps {
  entry: OrgLeaderEntry;
}

function LeaderItem({ entry }: LeaderItemProps) {
  const avatar = entry.avatarUrl ?? UNKNOWN_AVATAR;
  const name = entry.f3Name ?? "Unknown";
  return (
    <li>
      <button
        type="button"
        className="flex w-full cursor-default items-start gap-3 rounded-lg p-1 text-left"
        onClick={() =>
          console.log("[org-chart] leader", {
            userId: entry.userId,
            positionId: entry.positionId,
            roleId: entry.roleId,
            f3Name: entry.f3Name,
            title: entry.title,
          })
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatar}
          alt={name}
          className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
        <div>
          <div className="font-semibold text-foreground">{entry.title}</div>
          <div className="text-sm text-muted-foreground">{name}</div>
        </div>
      </button>
    </li>
  );
}

interface CountsProps {
  orgType: OrgType;
  descendantOrgs: Org[];
  metrics: OrgMetrics;
  footprintSqMi: number | null;
}

function Counts({
  orgType,
  descendantOrgs,
  metrics,
  footprintSqMi,
}: CountsProps) {
  const countOf = (type: OrgType) =>
    descendantOrgs.filter((o) => o.orgType === type).length;

  return (
    <div className="space-y-0.5 text-sm text-foreground">
      {orgType === "nation" && (
        <div>Sectors: {formatNumber(countOf("sector"))}</div>
      )}
      {(orgType === "nation" || orgType === "sector") && (
        <div>Areas: {formatNumber(countOf("area"))}</div>
      )}
      {(orgType === "nation" || orgType === "sector" || orgType === "area") && (
        <div>Regions: {formatNumber(countOf("region"))}</div>
      )}
      <div>Events: {formatNumber(metrics.events)}</div>
      <div>AOs: {formatNumber(metrics.aos)}</div>
      <div>Locations: {formatNumber(metrics.locations)}</div>
      {footprintSqMi != null && (
        <div>Footprint: {formatDecimal(footprintSqMi)} sq mi</div>
      )}
    </div>
  );
}

export interface OrgInfoPanelProps {
  status: "idle" | "loading" | "loaded" | "error";
  org?: Org;
  detail?: OrgDetail;
  descendantOrgs?: Org[];
  aggregatedMetrics?: OrgMetrics;
  footprintSqMi?: number | null;
  nearestAdminOrg?: NearestAdminOrg | null;
}

export function OrgInfoPanel({
  status,
  org,
  detail,
  descendantOrgs = [],
  aggregatedMetrics,
  footprintSqMi = null,
  nearestAdminOrg,
}: OrgInfoPanelProps) {
  if (status === "idle" || !org) {
    return (
      <div className="text-sm text-muted-foreground">
        Click or hover an area to see details.
      </div>
    );
  }

  const displayName = detail?.name ?? org.name;
  const displayType = (detail?.orgType ?? org.orgType).toUpperCase();

  if (status === "loading") {
    return (
      <>
        <div className="text-xl font-bold">{displayName}</div>
        <div className="text-xs tracking-widest text-muted-foreground uppercase">
          {displayType}
        </div>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <div className="text-xl font-bold">{displayName}</div>
        <div className="text-sm text-destructive">Failed to load details.</div>
      </>
    );
  }

  const email = detail?.email;
  const positions = detail?.positions ?? [];
  const roles = detail?.roles ?? [];
  const metrics = aggregatedMetrics ?? { events: 0, aos: 0, locations: 0 };

  const socialLinks: { href: string; label: string; icon: string }[] = [];
  if (detail?.website)
    socialLinks.push({ href: detail.website, label: "Website", icon: "🌐" });
  if (detail?.twitter)
    socialLinks.push({ href: detail.twitter, label: "X (Twitter)", icon: "𝕏" });
  if (detail?.facebook)
    socialLinks.push({ href: detail.facebook, label: "Facebook", icon: "f" });
  if (detail?.instagram)
    socialLinks.push({ href: detail.instagram, label: "Instagram", icon: "◻" });

  return (
    <>
      <button
        type="button"
        className="cursor-default text-left text-xl font-bold"
        onClick={() =>
          console.log("[org-chart] org", {
            id: org.id,
            name: displayName,
            orgType: detail?.orgType ?? org.orgType,
          })
        }
      >
        {displayName}
      </button>
      <div className="text-xs tracking-widest text-muted-foreground uppercase">
        {displayType}
      </div>

      {email && (
        <section className="border-t border-border pt-3">
          <div className="mb-1 text-xs tracking-widest text-muted-foreground uppercase">
            Organization Email
          </div>
          <a
            href={`mailto:${email}`}
            className="text-sm text-primary hover:underline"
          >
            {email}
          </a>
        </section>
      )}

      {socialLinks.length > 0 && (
        <section className="border-t border-border pt-3">
          <div className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">
            Connect
          </div>
          <div className="flex flex-wrap gap-2">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm transition hover:bg-primary/20"
              >
                {link.icon}
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-border pt-3">
        <div className="mb-1 text-xs tracking-widest text-muted-foreground uppercase">
          Counts
        </div>
        <Counts
          orgType={detail?.orgType ?? org.orgType}
          descendantOrgs={descendantOrgs}
          metrics={metrics}
          footprintSqMi={footprintSqMi}
        />
      </section>

      <section className="border-t border-border pt-3">
        <div className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">
          Positions
        </div>
        {positions.length > 0 ? (
          <ul className="space-y-3">
            {positions.map((p, i) => (
              <LeaderItem
                key={`p-${i}-${p.positionId ?? p.userId}`}
                entry={p}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No positions listed.</p>
        )}
      </section>

      <section className="border-t border-border pt-3">
        <div className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">
          Roles
        </div>
        {roles.length > 0 ? (
          <ul className="space-y-3">
            {roles.map((r, i) => (
              <LeaderItem key={`r-${i}-${r.roleId ?? r.userId}`} entry={r} />
            ))}
          </ul>
        ) : nearestAdminOrg ? (
          <p className="text-sm text-muted-foreground">
            No admins for this org.{" "}
            {nearestAdminOrg.adminNames.length > 0 ? (
              <>
                Reach out to{" "}
                {nearestAdminOrg.adminNames.length === 1 ? (
                  <span className="font-medium text-foreground">
                    {nearestAdminOrg.adminNames[0]}
                  </span>
                ) : (
                  nearestAdminOrg.adminNames.map((n, i) => (
                    <span key={i}>
                      {i > 0 &&
                        (i === nearestAdminOrg.adminNames.length - 1
                          ? ", or "
                          : ", ")}
                      <span className="font-medium text-foreground">{n}</span>
                    </span>
                  ))
                )}{" "}
                at the{" "}
                <span className="font-medium text-foreground">
                  {nearestAdminOrg.name}
                </span>{" "}
                {nearestAdminOrg.orgType}.
              </>
            ) : (
              <>
                Try contacting the{" "}
                <span className="font-medium text-foreground">
                  {nearestAdminOrg.name}
                </span>{" "}
                {nearestAdminOrg.orgType} for help.
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No admins listed.</p>
        )}
      </section>
    </>
  );
}
