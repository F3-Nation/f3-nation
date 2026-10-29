import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { GoogleAnalytics } from "@/components/google-analytics";
import { getSiteUrl, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_TITLE}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(getSiteUrl()),
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_TITLE,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="min-h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full bg-white text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100`}
      >
        <GoogleAnalytics />
        {children}
      </body>
    </html>
  );
}
