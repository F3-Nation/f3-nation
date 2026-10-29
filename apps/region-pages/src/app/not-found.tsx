import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">Region not found</h1>
        <p className="mb-8 text-gray-600 dark:text-gray-400">
          We couldn&apos;t find that F3 region. It may have been renamed or
          retired.
        </p>
        <Link
          href="/"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
        >
          Browse all regions
        </Link>
      </div>
    </div>
  );
}
