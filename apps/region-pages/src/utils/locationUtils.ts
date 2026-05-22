/**
 * Extracts city and state from a location string
 * @param location - Full location string (e.g., "123 Main St, City, State 12345")
 * @returns Formatted "City, State" string
 */
export function extractCityAndState(location: string): string {
  if (!location) return '';

  const parts = location.split(',').map((part) => part.trim());

  // Handle cases with no commas
  if (parts.length === 1) {
    return location;
  }

  // First pass: Look for city and state in US addresses
  for (let i = 0; i < parts.length - 1; i++) {
    const current = parts[i];
    const next = parts[i + 1];

    // Skip if current part is a street address
    if (/^\d+\s+[A-Za-z]/.exec(current)) continue;

    // Look for state pattern (2 letters, possibly followed by zip)
    const stateMatch = /^([A-Z]{2})(\s+\d{5})?$/i.exec(next);
    if (stateMatch) {
      return `${current}, ${stateMatch[1].toUpperCase()}`;
    }
  }

  // Second pass: Look for city and country in international addresses
  for (let i = 0; i < parts.length - 1; i++) {
    const current = parts[i];
    const next = parts[i + 1];

    // Skip if current part is a street address
    if (/^\d+\s+[A-Za-z]/.exec(current)) continue;

    // If we have a postal code followed by country
    if (
      /^[A-Z0-9\s]+$/i.exec(next) &&
      i + 2 < parts.length &&
      /^[A-Z]{2}$/i.exec(parts[i + 2])
    ) {
      // Make sure current part is a city (not a street number or postal code)
      if (!/^\d+/.exec(current) && !/^[A-Z0-9]+\s*[A-Z0-9]*$/i.exec(current)) {
        return `${current}, ${parts[i + 2].toUpperCase()}`;
      }
    }

    // Direct city and country format
    if (/^[A-Z]{2}$/i.exec(next)) {
      return `${current}, ${next.toUpperCase()}`;
    }
  }

  // Third pass: Handle addresses ending with US/United States
  const usMatch = /^\s*(US|United States)\s*$/i.exec(parts[parts.length - 1]);
  if (usMatch) {
    const cleanParts = parts.slice(0, -1);

    // Look for city and state again
    for (let i = 0; i < cleanParts.length - 1; i++) {
      const current = cleanParts[i];
      const next = cleanParts[i + 1];

      // Skip if current part is a street address
      if (/^\d+\s+[A-Za-z]/.exec(current)) continue;

      // Look for state pattern
      const stateMatch = /^([A-Z]{2})(\s+\d{5})?$/i.exec(next);
      if (stateMatch) {
        return `${current}, ${stateMatch[1].toUpperCase()}`;
      }
    }

    // If no state found, try the last two parts
    if (cleanParts.length >= 2) {
      const lastTwo = cleanParts.slice(-2);
      const stateMatch = /^([A-Z]{2})(\s+\d{5})?$/i.exec(lastTwo[1]);
      if (stateMatch) {
        return `${lastTwo[0]}, ${stateMatch[1].toUpperCase()}`;
      }
    }
  }

  // Final pass: Try the last two non-country parts
  const cleanParts = parts.filter(
    (part) => !/^\s*(US|United States)\s*$/i.exec(part)
  );

  if (cleanParts.length >= 2) {
    const lastTwo = cleanParts.slice(-2);
    const stateMatch = /^([A-Z]{2})(\s+\d{5})?$/i.exec(lastTwo[1]);
    if (stateMatch) {
      return `${lastTwo[0]}, ${stateMatch[1].toUpperCase()}`;
    }
  }

  return cleanParts.slice(-2).join(', ');
}
