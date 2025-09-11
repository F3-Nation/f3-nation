"use client";

import Script from "next/script";

import { env } from "~/env";

/**
 * Google Analytics component
 *
 * This component is used to track user interactions with the website.
 * It is used to track user interactions with the website.
 * It is used to track user interactions with the website.
 */
export const GoogleAnalytics = () => {
  return env.NEXT_PUBLIC_GA_MEASUREMENT_ID ? (
    <>
      <Script
        strategy="lazyOnload"
        src={`https://www.googletagmanager.com/gtag/js?id=${env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${env.NEXT_PUBLIC_GA_MEASUREMENT_ID}', {
          page_path: window.location.pathname,
          });
        `}
      </Script>
    </>
  ) : null;
};
