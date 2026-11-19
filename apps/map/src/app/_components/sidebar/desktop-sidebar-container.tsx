import { cn } from "@acme/ui";

/**
 * The left panel from `BreakPoints.PANEL` up: SIDEBAR_WIDTH_NARROW wide, then
 * SIDEBAR_WIDTH from `BreakPoints.LG`. Widths live in CSS so the server render
 * and first paint already match the window.
 */
export const DesktopSidebarContainer = (props: {
  children: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 left-0 hidden w-[280px] flex-col items-stretch border-r bg-background md:flex lg:w-360",
      )}
    >
      {props.children}
    </div>
  );
};
