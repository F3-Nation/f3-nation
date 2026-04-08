import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "~/app/globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "F3 Nation Auth",
  description: "F3 Nation Authentication Server",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
