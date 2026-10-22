export const ALL_LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

export function groupRegionsByLetter<T extends { name: string }>(
  regions: T[],
): Record<string, T[]> {
  return Object.fromEntries(
    ALL_LETTERS.map((letter) => [
      letter,
      regions.filter((r) => r.name.toUpperCase().startsWith(letter)),
    ]),
  );
}

/** The `?letter=` query param, defaulting to "A" when missing or invalid. */
export function resolveLetter(param: string | null | undefined): string {
  const requested = param?.toUpperCase();
  return requested && ALL_LETTERS.includes(requested) ? requested : "A";
}
