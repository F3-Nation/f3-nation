"use client";

import Script from "next/script";

/**
 * Google Analytics component that injects GA scripts when a measurement ID is provided.
 */
export const GoogleAnalytics = ({
  measurementId,
}: {
  measurementId?: string;
}) => {
  return measurementId ? (
    <>
      <Script
        strategy="lazyOnload"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', ${JSON.stringify(measurementId)}, {
          page_path: window.location.pathname,
          });
        `}
      </Script>
    </>
  ) : null;
};
