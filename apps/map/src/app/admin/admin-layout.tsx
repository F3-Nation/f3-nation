"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { Menu } from "lucide-react";

import {
  ADMIN_HEADER_HEIGHT,
  ADMIN_SIDEBAR_WIDTH,
  Z_INDEX,
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
import { AdminUserMenu } from "./_components/admin-user-menu";

const Layout = ({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) => {
  return (
    <div className="h-[100vh] w-full overflow-auto">
      <div
        className="fixed block w-full bg-card lg:hidden"
        style={{ height: ADMIN_HEADER_HEIGHT, zIndex: Z_INDEX.OVERLAY_BUTTONS }}
      >
        <div className="flex h-full w-full flex-row items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Image src="/f3_logo.png" alt="F3" width={48} height={48} />
            {title && <h1 className="text-lg font-bold">{title}</h1>}
          </div>
          <div className="flex items-center gap-2">
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
                <div className="flex max-h-[calc(100vh-5rem)] flex-col gap-4 overflow-y-auto py-4">
                  <AdminNavLinks linkClassName="flex flex-row items-center gap-3 rounded-lg px-3 py-3" />
                  <div className="mt-4 border-t pt-4">
                    <AdminUserMenu />
                  </div>
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
        <div className="flex justify-center px-2 py-6">
          <Image src="/f3_logo.png" alt="F3" width={100} height={100} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <AdminNavLinks
            className="flex flex-col"
            linkClassName="flex flex-row items-center gap-1 rounded-lg px-1 py-2"
          />
        </div>
        {/* User menu and version info */}
        <div className="flex w-full flex-col items-center justify-end gap-2 border-t p-2">
          <AdminUserMenu />
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
        <div
          className={cn("w-full overflow-hidden p-4 md:p-8 lg:p-10", className)}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export default Layout;
