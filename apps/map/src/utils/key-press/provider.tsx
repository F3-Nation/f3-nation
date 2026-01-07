"use client";

import { useEffect, useRef } from "react";

import { closeModal } from "../store/modal";
import { useKeyPress } from "./hook";
import { KeyPressContext } from "./util";

export const KeyPressProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const keyPress = useKeyPress();
  const escapePressedRef = useRef(false);

  useEffect(() => {
    const isEscapePressed = keyPress.isPressed("Escape");

    // Only close modal when Escape is first pressed (not on every render)
    if (isEscapePressed && !escapePressedRef.current) {
      escapePressedRef.current = true;
      closeModal();
    } else if (!isEscapePressed) {
      // Reset the ref when Escape is released
      escapePressedRef.current = false;
    }
  }, [keyPress]);

  return (
    <KeyPressContext.Provider value={keyPress}>
      {children}
    </KeyPressContext.Provider>
  );
};
