import { env } from "~/env";

export const trackEvent = (event: string, params?: unknown) => {
  if (typeof window !== "undefined" && "gtag" in window) {
    window.gtag("event", event, params);
  }
};

export const trackPageView = (url: string) => {
  const ga_id = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (typeof window !== "undefined" && "gtag" in window && ga_id) {
    window.gtag("config", ga_id, {
      page_path: url,
    });
  }
};
