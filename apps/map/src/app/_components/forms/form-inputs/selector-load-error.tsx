export function SelectorLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-xs text-destructive">
      Couldn&apos;t load options.{" "}
      <button
        type="button"
        className="underline underline-offset-2"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}
