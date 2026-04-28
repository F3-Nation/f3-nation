import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
} from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

const fallbackCountry: CountryCode = "US";
const countryNames =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : undefined;

export type PhoneCountry = CountryCode;

export const phoneCountryOptions = getCountries()
  .map((country) => ({
    country,
    label: `${country} +${getCountryCallingCode(country)}`,
    // Internal sort key — keep the dropdown in alphabetical-by-full-name
    // order even though the displayed label is the compact ISO code form.
    name: countryNames?.of(country) ?? country,
  }))
  .sort((left, right) => left.name.localeCompare(right.name))
  .map(({ country, label }) => ({ country, label }));

export function detectPhoneCountry(locale?: string): PhoneCountry {
  if (!locale) return fallbackCountry;

  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region && isSupportedCountry(region) ? region : fallbackCountry;
  } catch {
    return fallbackCountry;
  }
}
