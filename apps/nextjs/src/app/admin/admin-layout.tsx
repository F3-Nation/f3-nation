"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Menu } from "lucide-react";
import { signOut } from "next-auth/react";

import {
  ADMIN_HEADER_HEIGHT,
  ADMIN_SIDEBAR_WIDTH,
} from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@acme/ui/sheet";

import { VersionInfo } from "~/app/_components/version-info";
import { AdminNavLinks } from "./_components/admin-nav-links";

const Layout = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div className="h-[100vh] w-full overflow-auto">
      <div
        className="fixed block w-full bg-card lg:hidden"
        style={{ height: ADMIN_HEADER_HEIGHT }}
      >
        <div className="flex h-full w-full flex-row items-center justify-between px-4">
          <Image src="/f3_logo.png" alt="F3" width={48} height={48} />
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex flex-row items-center justify-center gap-2 rounded-md bg-primary p-2 text-base font-medium text-background"
            >
              <MapPin className="h-5 w-5" />
            </Link>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full">
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-4 py-4">
                  <AdminNavLinks linkClassName="flex flex-row items-center gap-3 rounded-lg px-3 py-3" />
                  <button
                    className="mt-4 flex w-full flex-row items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-base font-medium text-background"
                    onClick={async () => {
                      await signOut({
                        callbackUrl: "/",
                      });
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
      <div
        className="fixed hidden h-full flex-col justify-between bg-muted/20 lg:flex"
        style={{ width: ADMIN_SIDEBAR_WIDTH, zIndex: 1000 }}
      >
        <div className="">
          <div className="px-2 py-6">
            <div className="flex justify-center">
              <Image src="/f3_logo.png" alt="F3" width={100} height={100} />
            </div>
            <AdminNavLinks
              className="flex flex-col"
              linkClassName="flex flex-row items-center gap-3 rounded-lg px-3 py-4"
            />
          </div>
        </div>
        {/* Link to the main map */}
        <div className="flex w-full flex-col items-center justify-end gap-2">
          <Link
            href="/"
            className="flex flex-row items-center justify-center gap-2 rounded-md bg-primary p-2 text-base font-medium text-background"
          >
            <MapPin />
            Map
          </Link>
          <button
            className="rounded-md bg-foreground px-4 py-2 text-base font-medium text-background"
            onClick={async () => {
              await signOut({
                callbackUrl: "/",
              });
            }}
          >
            Sign Out
          </button>
          <VersionInfo className="mt-2 text-center text-gray-600" />
        </div>
      </div>
      <div className={`flex flex-col lg:flex-row`}>
        <div
          className="hidden h-full flex-shrink-0 lg:block"
          style={{ width: ADMIN_SIDEBAR_WIDTH }}
        />
        <div
          className="block w-full flex-shrink-0 lg:hidden"
          style={{ height: ADMIN_HEADER_HEIGHT }}
        />
        <div className={cn("w-full overflow-hidden p-10", className)}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
