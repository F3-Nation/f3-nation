import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Default fallback avatar URL */
export function getFallbackAvatar(name?: string): string {
  const normalizedName = name?.trim();
  const initial = (normalizedName?.length ? normalizedName : "F3")
    .charAt(0)
    .toUpperCase();
  // Return a data URI with the initial letter
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <rect width="80" height="80" fill="%23334155" rx="40"/>
      <text x="40" y="40" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="32" fill="white">${initial}</text>
    </svg>`,
  )}`;
}
