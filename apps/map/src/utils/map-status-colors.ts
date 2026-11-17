import type { MapStatus } from "~/utils/types";

interface StatusStyle {
  solidBg: string;
  /** For SVG pins drawn in `currentColor`. */
  text: string;
  chipBg: string;
}

const STATUS_STYLES: Record<NonNullable<MapStatus>, StatusStyle> = {
  closed: {
    solidBg: "bg-gray-500 dark:bg-gray-400",
    text: "text-gray-500 dark:text-gray-400",
    chipBg: "bg-gray-700",
  },
  "different-time": {
    solidBg: "bg-orange-400 dark:bg-orange-300",
    text: "text-orange-400 dark:text-orange-300",
    chipBg: "bg-orange-500",
  },
  miscellaneous: {
    solidBg: "bg-green-500 dark:bg-green-400",
    text: "text-green-500 dark:text-green-400",
    chipBg: "bg-green-600",
  },
  "event-instance": {
    solidBg: "bg-purple-500 dark:bg-purple-400",
    text: "text-purple-500 dark:text-purple-400",
    chipBg: "bg-purple-600",
  },
};

const SOLID_BG_DEFAULT = "bg-foreground";
const SELECTED_CHIP_BG_DEFAULT = "bg-primary";

const getStatusStyle = (status: MapStatus) =>
  status ? STATUS_STYLES[status] : undefined;

export const getStatusTextColor = (status: MapStatus) =>
  getStatusStyle(status)?.text ?? "text-primary";

export const getStatusSolidBg = (status: MapStatus) =>
  getStatusStyle(status)?.solidBg ?? SOLID_BG_DEFAULT;

export const getSelectedChipBg = (status: MapStatus) =>
  getStatusStyle(status)?.chipBg ?? SELECTED_CHIP_BG_DEFAULT;

const STATUSES: NonNullable<MapStatus>[] = [
  "closed",
  "different-time",
  "miscellaneous",
  "event-instance",
];

export const getDominantStatus = (
  events: { mapStatus: MapStatus }[],
): MapStatus => {
  for (const status of STATUSES) {
    if (events.some((e) => e.mapStatus === status)) return status;
  }
  return null;
};
