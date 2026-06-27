"use client";

import Script from "next/script";

/**
 * Google Analytics component
 *
 * This component is used to track user interactions with the website.
 * It is used to track user interactions with the website.
 * It is used to track user interactions with the website.
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
          gtag('config', '${measurementId}', {
          page_path: window.location.pathname,
          });
        `}
      </Script>
    </>
  ) : null;
};
