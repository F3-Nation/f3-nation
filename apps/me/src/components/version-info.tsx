"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@acme/ui/dialog";
import { VersionInfo as VersionInfoBase } from "@acme/ui/version-info";

import type { ChangelogEntry } from "@/lib/changelog";

interface VersionInfoProps {
  version: string;
  channel: string;
  changelog: ChangelogEntry[];
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function VersionInfo({ version, channel, changelog }: VersionInfoProps) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-0 pb-2">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="rounded transition-colors hover:bg-muted"
          >
            <VersionInfoBase
              versionLabel={<span>v{version}</span>}
              channel={channel}
              className="cursor-pointer px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground [&_span]:cursor-pointer"
            />
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Changelog</DialogTitle>
          </DialogHeader>
          {changelog.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No changelog entries yet.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {changelog[0]?.version !== version && (
                <p className="text-xs text-muted-foreground">
                  Showing user-facing changes. Releases up to v{version} since v
                  {changelog[0]?.version} contained only dependency updates.
                </p>
              )}
              {changelog.map((entry) => (
                <article key={entry.version}>
                  <header className="mb-3 flex items-center justify-between border-b pb-2">
                    <h2 className="text-base font-semibold">
                      v{entry.version}
                    </h2>
                    <time className="text-xs text-muted-foreground">
                      {formatDate(entry.date)}
                    </time>
                  </header>
                  <div className="flex flex-col gap-3">
                    {entry.sections.map((section) => (
                      <div key={section.title}>
                        <h3 className="mb-1 text-sm font-medium text-foreground/80">
                          {section.title}
                        </h3>
                        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                          {section.items.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
