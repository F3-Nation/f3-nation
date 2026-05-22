export function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(
    arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1)
  );
}
