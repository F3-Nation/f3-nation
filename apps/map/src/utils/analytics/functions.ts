import { env } from "~/env";

export const trackPageView = (url: string) => {
  const ga_id = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (typeof window !== "undefined" && "gtag" in window && ga_id) {
    window.gtag("config", ga_id, {
      page_path: url,
    });
  }
};
