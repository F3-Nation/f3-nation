import { useWindowSize } from "@react-hook/window-size";

import { BreakPoints } from "@acme/shared/app/constants";

export const useIsMobileWidth = () => {
  const [width] = useWindowSize();
  return {
    isMobileWidth: width < Number(BreakPoints.LG),
    isDesktopWidth: width >= Number(BreakPoints.LG),
  };
};
