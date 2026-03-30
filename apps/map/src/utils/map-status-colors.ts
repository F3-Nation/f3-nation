import type { MapStatus } from "~/utils/types";

interface StatusStyle {
  border: string;
  bg: string;
  text: string;
  darkBorder: string;
  darkBg: string;
  selectedBorder: string;
  selectedDarkBorder: string;
  selectedBg: string;
  selectedDarkBg: string;
  chipBg: string;
  clusterBg: string;
  clusterMid: string;
  clusterInner: string;
}

const STATUS_STYLES: Record<NonNullable<MapStatus>, StatusStyle> = {
  closing: {
    border: "border-red-500",
    bg: "bg-red-500",
    text: "text-white",
    darkBorder: "dark:border-red-400",
    darkBg: "dark:bg-red-400",
    selectedBorder: "!border-red-700",
    selectedDarkBorder: "dark:!border-red-500",
    selectedBg: "!bg-red-700",
    selectedDarkBg: "dark:!bg-red-500",
    chipBg: "bg-red-700",
    clusterBg: "bg-red-500/30 dark:bg-red-400/30",
    clusterMid: "bg-red-500/50 dark:bg-red-400/50",
    clusterInner: "bg-red-500 dark:bg-red-400",
  },
  deviation: {
    border: "border-orange-400",
    bg: "bg-orange-400",
    text: "text-white",
    darkBorder: "dark:border-orange-300",
    darkBg: "dark:bg-orange-300",
    selectedBorder: "!border-orange-500",
    selectedDarkBorder: "dark:!border-orange-400",
    selectedBg: "!bg-orange-500",
    selectedDarkBg: "dark:!bg-orange-400",
    chipBg: "bg-orange-500",
    clusterBg: "bg-orange-400/30 dark:bg-orange-300/30",
    clusterMid: "bg-orange-400/50 dark:bg-orange-300/50",
    clusterInner: "bg-orange-400 dark:bg-orange-300",
  },
  highlight: {
    border: "border-purple-500",
    bg: "bg-purple-500",
    text: "text-white",
    darkBorder: "dark:border-purple-400",
    darkBg: "dark:bg-purple-400",
    selectedBorder: "!border-purple-600",
    selectedDarkBorder: "dark:!border-purple-500",
    selectedBg: "!bg-purple-600",
    selectedDarkBg: "dark:!bg-purple-500",
    chipBg: "bg-purple-600",
    clusterBg: "bg-purple-500/30 dark:bg-purple-400/30",
    clusterMid: "bg-purple-500/50 dark:bg-purple-400/50",
    clusterInner: "bg-purple-500 dark:bg-purple-400",
  },
};

export const STATUS_BASE_DEFAULT =
  "border-foreground bg-foreground text-background";

export const getStatusBase = (status: MapStatus) =>
  status
    ? [
        STATUS_STYLES[status].border,
        STATUS_STYLES[status].bg,
        STATUS_STYLES[status].text,
        STATUS_STYLES[status].darkBorder,
        STATUS_STYLES[status].darkBg,
      ].join(" ")
    : STATUS_BASE_DEFAULT;

export const getSelectedBorder = (status: MapStatus) =>
  status
    ? `${STATUS_STYLES[status].selectedBorder} ${STATUS_STYLES[status].selectedDarkBorder}`
    : "!border-red-600 dark:!border-red-400";

export const getSelectedBg = (status: MapStatus) =>
  status
    ? `${STATUS_STYLES[status].selectedBorder} ${STATUS_STYLES[status].selectedBg} ${STATUS_STYLES[status].selectedDarkBg}`
    : "!border-red-600 !bg-red-600 dark:!bg-red-400";

export const getSelectedChipBg = (status: MapStatus) =>
  status ? STATUS_STYLES[status].chipBg : "bg-red-600";

export const getClusterBg = (status: MapStatus) =>
  status ? STATUS_STYLES[status].clusterBg : "";

export const getClusterMid = (status: MapStatus) =>
  status ? STATUS_STYLES[status].clusterMid : "";

export const getClusterInner = (status: MapStatus) =>
  status ? STATUS_STYLES[status].clusterInner : "";

const STATUSES: NonNullable<MapStatus>[] = [
  "closing",
  "deviation",
  "highlight",
];

export const getDominantStatus = (
  events: { mapStatus: MapStatus }[],
): MapStatus => {
  for (const status of STATUSES) {
    if (events.some((e) => e.mapStatus === status)) return status;
  }
  return null;
};
