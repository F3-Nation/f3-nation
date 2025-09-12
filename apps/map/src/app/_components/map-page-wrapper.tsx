import Image from "next/image";
import Link from "next/link";

import { HEADER_HEIGHT } from "@acme/shared/app/constants";
import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";

import { MapSearchBox } from "./map/map-searchbox-desktop";
import { DesktopSidebarContainer } from "./sidebar/desktop-sidebar-container";
import { Sidebar } from "./sidebar/sidebar";

const _DesktopHeaderContainer = (props: { children: React.ReactNode }) => {
  return (
    <div
      className={cn(
        `absolute left-0 right-0 top-0`,
        `items-center justify-center`,
        `border-b-2 border-ring bg-background px-2`,
        `hidden lg:flex`,
      )}
      style={{ height: HEADER_HEIGHT }}
    >
      {props.children}
    </div>
  );
};

const _Header = () => {
  return (
    <>
      <Link
        href="https://f3nation.com/"
        target="_blank"
        className="absolute left-4"
      >
        <Image
          src="/f3_logo.png"
          alt="F3 Logo"
          width={64}
          height={64}
          className="rounded-lg"
        />
      </Link>
      <div className="relative w-2/5">
        <MapSearchBox hideLogo className="" />
        <p className="mt-1 w-full text-center text-xs">
          Search F3’s network of 4,368 free, peer-led workouts
        </p>
      </div>
    </>
  );
};

export const MapPageWrapper = (props: { children: React.ReactNode }) => {
  RERENDER_LOGS && console.log("HeaderAndSidebar rerender");
  return (
    <>
      <DesktopSidebarContainer>
        <Sidebar />
      </DesktopSidebarContainer>
      <div className={cn(`lg:pl-360 pl-0`)}>{props.children}</div>
    </>
  );
};
