import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#e01f1f",
};

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "F3 Nation Apps",
  description:
    "The F3 Nation tech ecosystem — tools and apps built by the community, for the community.",
  icons: {
    icon: "/favicon.ico",
    apple: "/f3_logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} min-h-screen bg-background text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
