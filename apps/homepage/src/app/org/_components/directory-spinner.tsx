/** Full-screen spinner shown while a directory view loads. */
export function DirectorySpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#f6f3ea]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}
