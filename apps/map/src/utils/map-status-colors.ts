import type { MapStatus } from "~/utils/types";

interface StatusStyle {
  base: string;
  solidBg: string;
  selectedBorder: string;
  selected: string;
  chipBg: string;
  clusterBg: string;
  clusterMid: string;
  clusterInner: string;
}

const STATUS_STYLES: Record<NonNullable<MapStatus>, StatusStyle> = {
  closed: {
    base: "border-gray-500 bg-gray-500 text-white dark:border-gray-400 dark:bg-gray-400",
    solidBg: "bg-gray-500 dark:bg-gray-400",
    selectedBorder: "!border-gray-700 dark:!border-gray-500",
    selected:
      "!border-gray-700 !bg-gray-700 dark:!border-gray-500 dark:!bg-gray-500",
    chipBg: "bg-gray-700",
    clusterBg: "bg-gray-500/30 dark:bg-gray-400/30",
    clusterMid: "bg-gray-500/50 dark:bg-gray-400/50",
    clusterInner: "bg-gray-500 dark:bg-gray-400",
  },
  "different-time": {
    base: "border-orange-400 bg-orange-400 text-white dark:border-orange-300 dark:bg-orange-300",
    solidBg: "bg-orange-400 dark:bg-orange-300",
    selectedBorder: "!border-orange-500 dark:!border-orange-400",
    selected:
      "!border-orange-500 !bg-orange-500 dark:!border-orange-400 dark:!bg-orange-400",
    chipBg: "bg-orange-500",
    clusterBg: "bg-orange-400/30 dark:bg-orange-300/30",
    clusterMid: "bg-orange-400/50 dark:bg-orange-300/50",
    clusterInner: "bg-orange-400 dark:bg-orange-300",
  },
  miscellaneous: {
    base: "border-green-500 bg-green-500 text-white dark:border-green-400 dark:bg-green-400",
    solidBg: "bg-green-500 dark:bg-green-400",
    selectedBorder: "!border-green-600 dark:!border-green-500",
    selected:
      "!border-green-600 !bg-green-600 dark:!border-green-500 dark:!bg-green-500",
    chipBg: "bg-green-600",
    clusterBg: "bg-green-500/30 dark:bg-green-400/30",
    clusterMid: "bg-green-500/50 dark:bg-green-400/50",
    clusterInner: "bg-green-500 dark:bg-green-400",
  },
  "event-instance": {
    base: "border-purple-500 bg-purple-500 text-white dark:border-purple-400 dark:bg-purple-400",
    solidBg: "bg-purple-500 dark:bg-purple-400",
    selectedBorder: "!border-purple-600 dark:!border-purple-500",
    selected:
      "!border-purple-600 !bg-purple-600 dark:!border-purple-500 dark:!bg-purple-500",
    chipBg: "bg-purple-600",
    clusterBg: "bg-purple-500/30 dark:bg-purple-400/30",
    clusterMid: "bg-purple-500/50 dark:bg-purple-400/50",
    clusterInner: "bg-purple-500 dark:bg-purple-400",
  },
};

export const STATUS_BASE_DEFAULT =
  "border-foreground bg-foreground text-background";

const SOLID_BG_DEFAULT = "bg-foreground";
const SELECTED_BORDER_DEFAULT = "!border-red-600 dark:!border-red-400";
const SELECTED_BG_DEFAULT = "!border-red-600 !bg-red-600 dark:!bg-red-400";
const SELECTED_CHIP_BG_DEFAULT = "bg-red-600";

const getStatusStyle = (status: MapStatus) =>
  status ? STATUS_STYLES[status] : undefined;

export const getStatusBase = (status: MapStatus) =>
  getStatusStyle(status)?.base ?? STATUS_BASE_DEFAULT;

export const getStatusSolidBg = (status: MapStatus) =>
  getStatusStyle(status)?.solidBg ?? SOLID_BG_DEFAULT;

export const getSelectedBorder = (status: MapStatus) =>
  getStatusStyle(status)?.selectedBorder ?? SELECTED_BORDER_DEFAULT;

export const getSelectedBg = (status: MapStatus) =>
  getStatusStyle(status)?.selected ?? SELECTED_BG_DEFAULT;

export const getSelectedChipBg = (status: MapStatus) =>
  getStatusStyle(status)?.chipBg ?? SELECTED_CHIP_BG_DEFAULT;

export const getClusterBg = (status: MapStatus) =>
  getStatusStyle(status)?.clusterBg ?? "";

export const getClusterMid = (status: MapStatus) =>
  getStatusStyle(status)?.clusterMid ?? "";

export const getClusterInner = (status: MapStatus) =>
  getStatusStyle(status)?.clusterInner ?? "";

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
