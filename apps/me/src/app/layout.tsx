import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { Navbar } from "@/components/navbar";
import { ToastProvider, Toaster } from "@/components/ui/toast";
import { SaveProvider } from "@/lib/save-context";

export const metadata: Metadata = {
  title: "F3 Me — Profile Manager",
  description:
    "Manage your F3 Nation profile, avatar, emergency contacts, and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ToastProvider>
          <AuthProvider>
            <SaveProvider>
              <Navbar />
              <main className="min-h-[calc(100vh-4rem)]">{children}</main>
            </SaveProvider>
          </AuthProvider>
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
