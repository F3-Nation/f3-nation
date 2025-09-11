"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect } from "react";
import { useWindowSize } from "@react-hook/window-size";

import { BreakPoints } from "@acme/shared/app/constants";
import { ZustandStore } from "@acme/shared/common/classes";

import { appStore } from "./store/app";

interface TouchDeviceContextType {
  isTouchDevice: boolean;
  isMobileDeviceWidth: boolean;
}

const TouchDeviceContext = createContext<TouchDeviceContextType | undefined>(
  undefined,
);

export const touchState = new ZustandStore({
  initialState: {
    isTouchDevice: false,
    hasTouched: false,
    hasMouseMoved: false,
  },
  persistOptions: {
    name: "touch-device",
    persistedKeys: [],
    version: 1,
    getStorage: () => localStorage,
  },
});

export function TouchDeviceProvider({ children }: { children: ReactNode }) {
  const isTouchDevice = touchState.use.isTouchDevice();
  const isMobileDeviceWidth = appStore.use.isMobileDeviceWidth();
  const [width] = useWindowSize();

  useEffect(() => {
    appStore.setState({
      isMobileDeviceWidth: width < Number(BreakPoints.LG),
    });
  }, [width]);

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === "undefined") return;

    // Primary check for touch capability
    const hasTouch = Boolean(
      "ontouchstart" in window ||
        // @ts-expect-error - DocumentTouch is not recognized by TypeScript
        (window.DocumentTouch && document instanceof DocumentTouch),
    );

    // Only set up listeners if touch capability is detected
    if (hasTouch) {
      const touchStartHandler = () => {
        touchState.setState({ isTouchDevice: true, hasTouched: true });
        cleanup();
      };

      const mouseStartHandler = () => {
        touchState.setState({ isTouchDevice: false, hasMouseMoved: true });
        cleanup();
      };

      const cleanup = () => {
        window.removeEventListener("touchstart", touchStartHandler);
        window.removeEventListener("mousemove", mouseStartHandler);
      };

      window.addEventListener("touchstart", touchStartHandler, { once: true });
      window.addEventListener("mousemove", mouseStartHandler, { once: true });

      return cleanup;
    }
  }, []);

  return (
    <TouchDeviceContext.Provider value={{ isTouchDevice, isMobileDeviceWidth }}>
      {children}
    </TouchDeviceContext.Provider>
  );
}

export function useTouchDevice() {
  const context = useContext(TouchDeviceContext);
  if (context === undefined) {
    throw new Error("useTouchDevice must be used within a TouchDeviceProvider");
  }
  return context;
}

export function isTouchDevice() {
  return touchState.get("isTouchDevice");
}
