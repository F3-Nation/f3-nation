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
    label: `${countryNames?.of(country) ?? country} (+${getCountryCallingCode(country)})`,
  }))
  .sort((left, right) => left.label.localeCompare(right.label));

export function detectPhoneCountry(locale?: string): PhoneCountry {
  if (!locale) return fallbackCountry;

  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region && isSupportedCountry(region) ? region : fallbackCountry;
  } catch {
    return fallbackCountry;
  }
}
