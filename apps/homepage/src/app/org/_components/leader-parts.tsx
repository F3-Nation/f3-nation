import type { ReactNode } from "react";

import type { LeaderRow } from "../_lib/leadership-table";

function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}

/** Placeholder text for an org with nobody listed. */
export function EmptyLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold tracking-widest text-[#8a7f66] uppercase italic">
      {children}
    </span>
  );
}

/** The leader's photo, or their initials. `small` for the phone list. */
export function Avatar({ row, small }: { row: LeaderRow; small?: boolean }) {
  const size = small ? "h-7 w-7 rounded-md" : "h-9 w-9 rounded-lg";
  if (row.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={row.avatarUrl}
        alt=""
        className={`${size} shrink-0 object-cover`}
        loading="lazy"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${size} flex shrink-0 items-center justify-center bg-[#f1ead7] text-xs font-semibold text-[#5b5341]`}
    >
      {initials(row.f3Name)}
    </span>
  );
}

/** The Position / Role tag after a title. */
export function KindTag({ kind }: { kind: LeaderRow["kind"] }) {
  return (
    <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] tracking-widest text-muted-foreground uppercase">
      {kind}
    </span>
  );
}
