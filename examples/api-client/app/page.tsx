import Link from "next/link";

type Region = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  description?: string | null;
};

type RegionsResponse = {
  data: Region[];
  metadata: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    next: number | null;
    prev: number | null;
  };
};

type PageProps = {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 10;

const parsePositiveInt = (
  value: string | string[] | undefined,
  fallback: number,
) => {
  const numericValue = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(numericValue)) return fallback;
  const wholeNumber = Math.floor(numericValue);
  return wholeNumber > 0 ? wholeNumber : fallback;
};

const formatLocation = (region: Region) => {
  const parts = [region.city, region.state, region.country].filter(
    (part) => part && part.trim().length,
  );
  return parts.length ? parts.join(", ") : "Location coming soon";
};

const fetchRegions = async (page: number): Promise<RegionsResponse> => {
  const apiBaseUrl = process.env.API_BASE_URL;
  const apiKey = process.env.API_KEY;

  if (!apiBaseUrl || !apiKey) {
    throw new Error("Missing API_BASE_URL or API_KEY in environment.");
  }

  const url = new URL("/api/v1/regions", apiBaseUrl);
  url.searchParams.set("page", page.toString());
  url.searchParams.set("pageSize", PAGE_SIZE.toString());

  const response = await fetch(url.toString(), {
    headers: {
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch regions (status ${response.status}).`);
  }

  const payload = (await response.json()) as RegionsResponse;
  return payload;
};

export default async function Home({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const page = parsePositiveInt(resolvedSearchParams?.page, 1);

  try {
    const { data, metadata } = await fetchRegions(page);

    return (
      <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
        <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
          <header className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-orange-600">
              Regions API demo
            </p>
            <h1 className="text-3xl font-bold leading-tight">F3 Regions</h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Data loaded from{" "}
              <code className="rounded bg-zinc-100 px-2 py-1 text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                /api/v1/regions
              </code>{" "}
              using API_BASE_URL and API_KEY from your .env.local file.
            </p>
          </header>

          <section className="grid gap-4">
            {data.map((region) => (
              <article
                key={region.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold">{region.name}</h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {formatLocation(region)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Slug: {region.slug}
                    </p>
                  </div>
                  {region.website ? (
                    <a
                      href={region.website}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Visit site
                    </a>
                  ) : null}
                </div>
                {region.description ? (
                  <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
                    {region.description}
                  </p>
                ) : null}
              </article>
            ))}
          </section>

          <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <div>
              Page {metadata.page} of {metadata.totalPages} · {metadata.total}{" "}
              regions total
            </div>
            <div className="flex items-center gap-2">
              <PaginationLink page={metadata.prev} label="Previous" />
              <PaginationLink page={metadata.next} label="Next" />
            </div>
          </div>
        </main>
      </div>
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred.";

    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
        <div className="max-w-xl space-y-3 rounded-xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900/60 dark:bg-zinc-900">
          <h1 className="text-2xl font-semibold text-red-700 dark:text-red-300">
            Unable to load regions
          </h1>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Make sure the API service is running at the configured API_BASE_URL
            and that API_KEY matches the backend configuration.
          </p>
        </div>
      </div>
    );
  }
}

type PaginationLinkProps = {
  label: string;
  page: number | null;
};

function PaginationLink({ label, page }: PaginationLinkProps) {
  if (!page) {
    return (
      <span className="rounded-full bg-zinc-100 px-3 py-1.5 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        {label}
      </span>
    );
  }

  const searchParams = new URLSearchParams();
  searchParams.set("page", page.toString());

  return (
    <Link
      href={`/?${searchParams.toString()}`}
      className="rounded-full bg-zinc-900 px-3 py-1.5 text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {label}
    </Link>
  );
}
