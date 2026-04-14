import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F3 Redirect Admin",
  description:
    "Self-serve custom domain registration for F3 regions. Register a hostname, follow the DNS setup, cut over.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b bg-card">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <div>
              <h1 className="text-lg font-semibold">F3 Redirect Admin</h1>
              <p className="text-xs text-muted-foreground">
                Region custom domains — register, monitor, manage.
              </p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
