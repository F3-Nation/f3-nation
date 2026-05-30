import Image from "next/image";

interface App {
  name: string;
  description: string;
  href?: string;
  localHref?: string;
  linkLabel?: string;
}

const isLocal = process.env.NEXT_PUBLIC_LOCAL_DEV === "true";

const APPS: App[] = [
  {
    name: "F3 Map",
    description:
      "Find F3 workouts near you. Browse every workout group across the nation on an interactive map.",
    href: "https://map.f3nation.com",
    localHref: "http://localhost:3000",
  },
  {
    name: "F3 Near Me",
    description:
      "Lightweight, fast map for discovering F3 workout locations near you — no account needed.",
    href: "https://f3near.me",
  },
  {
    name: "F3 Me",
    description:
      "Your personal F3 profile. Update your avatar, manage emergency contacts, and control your info.",
    href: "https://me.f3nation.com",
    localHref: "http://localhost:3003",
  },
  {
    name: "Admin",
    description:
      "Administrative portal for region and group leadership. Manage locations, events, and organization settings.",
    href: "https://admin.f3nation.com",
    localHref: "http://localhost:3002",
  },
  {
    name: "PAX Vault",
    description:
      "Analytics and reporting for F3 regions. Participation, leadership load, attendance trends — data over vibes.",
    href: "https://pax-vault.f3nation.com",
  },
  {
    name: "The Codex",
    description:
      "The F3 Exicon and Lexicon — a living, searchable repository of exercises and F3 terminology built by the community.",
    href: "https://codex.f3nation.com",
  },
  {
    name: "Slack Bot",
    description:
      "The primary way most PAX interact with F3 tech. Scheduling, attendance tracking, and region management — installed on 300+ workspaces.",
    href: "https://docs.google.com/document/d/1e7tmuY3irKDt9oy1URQVcxPwxyet1ZY_bVZhGvhESEw",
    linkLabel: "Learn More",
  },
  {
    name: "Region Pages",
    description:
      "Dedicated pages for F3 regions — workout calendars, member directories, event info, and contact details for each local community.",
    href: "https://regions.f3nation.com",
  },
  {
    name: "Org Chart",
    description:
      "Geographic digital directory visualizing F3's organizational structure — Sectors, Areas, and Regions on a map.",
    href: "https://org.f3nation.com",
  },
  {
    name: "Auth",
    description:
      "Shared SSO authentication powering F3 Nation apps. Secure, centralized sign-in for PAX across the ecosystem.",
    localHref: "http://localhost:3004",
  },
  {
    name: "API",
    description:
      "The F3 Nation data API. Unified backend powering the map, admin, and other apps — the single source of truth for F3 data.",
    href: "https://api.f3nation.com",
    localHref: "http://localhost:3001",
  },
  {
    name: "Status",
    description:
      "Real-time health and status for all F3 Nation services. Check if something's down before filing a bug report.",
    href: "https://status.f3nation.com",
  },
];

function ArrowIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function AppCard({ app }: { app: App }) {
  const label = app.linkLabel ?? "Open";
  const resolvedHref = isLocal ? (app.localHref ?? app.href) : app.href;
  const inner = (
    <>
      <h2 className="mb-2 text-lg font-semibold text-foreground">{app.name}</h2>
      <p className="mb-4 flex-1 text-sm text-muted-foreground">
        {app.description}
      </p>
      {resolvedHref && (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          {label} <ArrowIcon />
        </span>
      )}
    </>
  );

  if (!resolvedHref) {
    return (
      <div className="flex flex-col rounded-lg border border-border bg-card p-6 shadow-sm">
        {inner}
      </div>
    );
  }

  return (
    <a
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-lg border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      {inner}
    </a>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="mb-12 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center">
            <Image
              src="/f3_logo.png"
              alt="F3 Nation logo"
              width={64}
              height={64}
              priority
            />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            F3 Nation Tech
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            A volunteer group building the digital platform behind{" "}
            <a
              href="https://f3nation.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              F3 Nation
            </a>{" "}
            — free, peer-led outdoor workout groups for men. Modernizing the
            &ldquo;How&rdquo; to support the &ldquo;Why.&rdquo;
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((app) => (
            <AppCard key={app.name} app={app} />
          ))}
        </div>
      </div>
    </div>
  );
}
