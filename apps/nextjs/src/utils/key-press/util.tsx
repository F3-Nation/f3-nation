"use client";

import { createContext } from "react";

export const KeyPressContext = createContext<KeyPressContextType | null>(null);

interface KeyPressContextType {
  isPressed: (key: string) => boolean;
  pressedKeys: Set<string>;
}
