"use client";

import { closeModal } from "../store/modal";
import { useKeyPress } from "./hook";
import { KeyPressContext } from "./util";

export const KeyPressProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const keyPress = useKeyPress();

  if (keyPress.isPressed("Escape")) {
    closeModal();
  }

  return (
    <KeyPressContext.Provider value={keyPress}>
      {children}
    </KeyPressContext.Provider>
  );
};
