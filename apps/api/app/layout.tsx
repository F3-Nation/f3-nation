import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
        <meta
          name="googlebot"
          content="noindex, nofollow, noarchive, nosnippet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
