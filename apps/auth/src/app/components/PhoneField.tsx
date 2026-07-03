"use client";

import PhoneInput from "react-phone-number-input/input";

import { phoneCountryOptions } from "~/lib/phone";
import type { PhoneCountry } from "~/lib/phone";

interface PhoneFieldProps {
  /** DOM id for the phone `<input>`; the country `<select>` gets `${id}Country`. */
  id: string;
  /** Visible label rendered above the field. */
  label: string;
  /** Placeholder for the phone input. */
  placeholder?: string;
  /** E.164 string emitted by the input, or `""` when empty. */
  value: string;
  onChange: (value: string) => void;
  /** ISO-3166 country whose calling code/national format the input expects. */
  country: PhoneCountry;
  onCountryChange: (country: PhoneCountry) => void;
}

/**
 * Country selector + cursor-preserving masked phone input, laid out as a
 * 2-column grid that adapts to content (`max-content` for the country
 * trigger, `minmax(0,1fr)` for the input). The `max-content` track lets the
 * native `<select>` size itself to the widest option label — no magic width
 * constant to keep in sync with calling-code length, font, or browser chrome.
 *
 * Switching country clears the current value because `react-phone-number-input`
 * requires `value` (E.164) to start with `country`'s calling code; a stale
 * value tied to the previous country produces a noisy console error.
 */
export function PhoneField({
  id,
  label,
  placeholder,
  value,
  onChange,
  country,
  onCountryChange,
}: PhoneFieldProps) {
  const inputClass =
    "w-full rounded-md border bg-background px-4 py-3 text-base outline-hidden focus:ring-2 focus:ring-ring";
  const selectClass = `${inputClass} pr-10`;

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-medium">
        {label}
      </label>
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-3">
        <select
          id={`${id}Country`}
          value={country}
          onChange={(e) => {
            onCountryChange(e.target.value as PhoneCountry);
            onChange("");
          }}
          className={selectClass}
        >
          {phoneCountryOptions.map((option) => (
            <option key={option.country} value={option.country}>
              {option.label}
            </option>
          ))}
        </select>
        <PhoneInput
          id={id}
          country={country}
          value={value}
          onChange={(next) => onChange(next ?? "")}
          placeholder={placeholder}
          className={inputClass}
        />
      </div>
    </div>
  );
}
