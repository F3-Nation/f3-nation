import Link from "next/link";

import { changelog } from "@acme/shared/app/changelog";

export default function ChangelogPage() {
  return (
    <main className="pointer-events-auto relative max-h-dvh gap-4 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-[3%] py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Changelog</h1>
          <Link
            href="/"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            Back to Map
          </Link>
        </div>

        <p className="text-muted-foreground">
          Release notes and updates for the F3 Nation Map. Have a feature
          request or found a bug?{" "}
          <Link
            href="https://github.com/F3-Nation/f3-nation/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            Submit it on GitHub
          </Link>
          .
        </p>

        <div className="flex flex-col gap-8">
          {changelog.map((entry) => (
            <article
              key={entry.version}
              className="rounded-lg border bg-card p-6"
            >
              <header className="mb-4 flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">
                    v{entry.version}
                    {entry.title && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        — {entry.title}
                      </span>
                    )}
                  </h2>
                </div>
                <time className="text-sm text-muted-foreground">
                  {formatDate(entry.date)}
                </time>
              </header>

              <div className="flex flex-col gap-4">
                {entry.sections.map((section) => (
                  <div key={section.title}>
                    <h3 className="mb-2 font-medium text-foreground/80">
                      {section.title}
                    </h3>
                    <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                      {section.items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <footer className="border-t pt-4 text-center text-sm text-muted-foreground">
          <p>
            View all issues and feature requests on{" "}
            <Link
              href="https://github.com/F3-Nation/f3-nation/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
            >
              GitHub
            </Link>
          </p>
        </footer>
      </div>
    </main>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
