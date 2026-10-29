"use client";

import Link from "next/link";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  // `retry` refetches the failed segment from the server; `reset` would only
  // re-render it and could show the same failed result after the API recovers.
  retry: () => void;
}) {
  // Server render errors are logged server-side (matched by digest). Errors
  // thrown in client components are not reported anywhere. Don't echo raw
  // error messages to visitors.
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">Something went wrong!</h1>
        <p className="mb-8 text-gray-600 dark:text-gray-400">
          An unexpected error occurred
        </p>
        <div className="flex justify-center gap-4">
          <button
            onClick={retry}
            className="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-gray-200 px-4 py-2 transition-colors hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
