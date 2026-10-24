import Image from "next/image";

import type { App } from "./_lib/apps";
import { APP_GROUPS, resolveHref, selectAppGroups } from "./_lib/apps";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_DEV === "true";

/** The directory for this build's channel (NEXT_PUBLIC_CHANNEL, inlined at build time). */
const CHANNEL_APP_GROUPS = selectAppGroups();

if (process.env.NODE_ENV === "development") {
  const titles = APP_GROUPS.map((g) => g.title);
  if (new Set(titles).size !== titles.length)
    throw new Error("Duplicate AppGroup title — titles are used as React keys");
  for (const group of APP_GROUPS) {
    const names = group.apps.map((a) => a.name);
    if (new Set(names).size !== names.length)
      throw new Error(
        `Duplicate app name in group "${group.title}" — names are used as React keys`,
      );
  }
}

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
  const resolvedHref = resolveHref(app, isLocal);
  const inner = (
    <>
      <h3 className="mb-2 text-lg font-semibold text-foreground">{app.name}</h3>
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
      <div className="flex flex-col rounded-lg border border-border bg-card p-6 shadow-xs">
        {inner}
      </div>
    );
  }

  return (
    <a
      href={resolvedHref}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-lg border border-border bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
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

        <div className="space-y-16">
          {CHANNEL_APP_GROUPS.map((group) => (
            <section key={group.title}>
              <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  {group.title}
                </h2>
                <p className="mt-1 text-muted-foreground">
                  {group.description}
                </p>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {group.apps.map((app) => (
                  <AppCard key={app.name} app={app} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
