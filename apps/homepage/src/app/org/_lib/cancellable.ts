/**
 * Settle `promise` into `onResult` or `onError` unless the returned cancel
 * function ran first. Use it as an effect's cleanup, so that when React
 * Strict Mode runs the effect twice in development, only the surviving run
 * applies its result.
 */
export function runCancellable<T>(
  promise: Promise<T>,
  onResult: (value: T) => void,
  onError: (err: unknown) => void,
): () => void {
  let cancelled = false;
  promise.then(
    (value) => {
      if (!cancelled) onResult(value);
    },
    (err: unknown) => {
      if (!cancelled) onError(err);
    },
  );
  return () => {
    cancelled = true;
  };
}
