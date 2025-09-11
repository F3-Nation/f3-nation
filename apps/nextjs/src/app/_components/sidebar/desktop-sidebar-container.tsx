import { SIDEBAR_WIDTH } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

export const DesktopSidebarContainer = (props: {
  children: React.ReactNode;
}) => {
  return (
    <div
      className={cn(
        `absolute bottom-0 left-0 top-0 hidden flex-col items-stretch bg-background pt-4 dark:border-r lg:flex`,
      )}
      style={{ width: SIDEBAR_WIDTH }}
    >
      {props.children}
    </div>
  );
};
