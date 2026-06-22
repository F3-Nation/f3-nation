import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Navbar } from "@/components/navbar";
import { ToastProvider, Toaster } from "@/components/ui/toast";
import { SaveProvider } from "@/lib/save-context";
import { GoogleAnalytics } from "@/components/google-analytics";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "F3 Me — Profile Manager",
  description:
    "Manage your F3 Nation profile, avatar, emergency contacts, and more.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} bg-background text-foreground min-h-screen overflow-x-hidden overscroll-y-none antialiased`}
      >
        <GoogleAnalytics />
        <ToastProvider>
          <AuthProvider>
            <SaveProvider>
              <Navbar />
              <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
            </SaveProvider>
          </AuthProvider>
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
