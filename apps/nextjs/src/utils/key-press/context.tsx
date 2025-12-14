import { useContext } from "react";

import { KeyPressContext } from "./util";

export const useKeyPressContext = () => {
  const context = useContext(KeyPressContext);
  if (!context) {
    throw new Error(
      "useKeyPressContext must be used within a KeyPressProvider",
    );
  }
  return context;
};
