export const ALL_LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i)
);
const fifteenMinutes = 60 * 15;
export const cacheTtl = fifteenMinutes;
