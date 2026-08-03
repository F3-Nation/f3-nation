"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@acme/ui/dialog";

import type { ChangelogEntry } from "@/lib/changelog";

interface VersionInfoProps {
  version: string;
  channel: string;
  changelog: ChangelogEntry[];
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day).toLocaleDateString("en-US", {
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
            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-primary underline underline-offset-2 transition-colors hover:text-primary/80"
          >
            <span>v{version}</span>
            <span>({channel})</span>
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
