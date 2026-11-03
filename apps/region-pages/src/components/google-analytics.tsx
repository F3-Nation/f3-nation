import Script from "next/script";

import { env } from "@/env";
import { nonEmpty } from "@/lib/site";

// The site's existing GA property: prod reports here when GA_MEASUREMENT_ID is
// unset, so analytics history stays in one place.
const PROD_GA_ID = "G-44DEXNRMCP";

export function GoogleAnalytics() {
  const gaId =
    nonEmpty(env.GA_MEASUREMENT_ID) ??
    (env.F3_CHANNEL === "prod" ? PROD_GA_ID : undefined);
  if (!gaId) return null;

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
