import Script from "next/script";

import { nonEmpty } from "@/lib/site";

// The legacy app hard-coded this property; keep reporting to it from prod.
const LEGACY_PROD_GA_ID = "G-44DEXNRMCP";

export function GoogleAnalytics() {
  const gaId =
    nonEmpty(process.env.GA_MEASUREMENT_ID) ??
    (process.env.F3_CHANNEL === "prod" ? LEGACY_PROD_GA_ID : undefined);
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
