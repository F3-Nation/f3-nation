import { RERENDER_LOGS } from "@acme/shared/common/constants";

import { DesktopSidebarContainer } from "./sidebar/desktop-sidebar-container";
import { Sidebar } from "./sidebar/sidebar";

export const MapPageWrapper = (props: { children: React.ReactNode }) => {
  RERENDER_LOGS && console.log("HeaderAndSidebar rerender");
  return (
    <>
      <DesktopSidebarContainer>
        <Sidebar />
      </DesktopSidebarContainer>
      {/* Padding matches the panel width: SIDEBAR_WIDTH_NARROW, then SIDEBAR_WIDTH */}
      <div className="pl-0 md:pl-[280px] lg:pl-360">{props.children}</div>
    </>
  );
};
