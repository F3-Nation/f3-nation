"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { trackPageView } from "~/utils/analytics/functions";

export const RouteChangeTracker = () => {
  return (
    <Suspense fallback={null}>
      <SuspendedRouteChangeTracker />
    </Suspense>
  );
};

const SuspendedRouteChangeTracker = () => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname) {
      const url = searchParams?.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;
      trackPageView(url);
    }
  }, [pathname, searchParams]);

  return null;
};
