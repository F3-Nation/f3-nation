import type { StatusTarget } from "@/lib/status";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_DEV === "true";

export const STATUS_TARGETS: StatusTarget[] = [
  {
    id: "me",
    label: "F3 Me",
    url: isLocal
      ? "http://localhost:3003/health"
      : "https://me.f3nation.com/health",
    source: "contract",
  },
];
