export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <a href="/" className="underline underline-offset-4">
        Back to the apps directory
      </a>
    </main>
  );
}
