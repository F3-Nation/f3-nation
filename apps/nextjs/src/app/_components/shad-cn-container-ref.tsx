"use client";

import { appStore } from "~/utils/store/app";

export const ShadCnContainer = () => {
  const shadCnContainterRef = appStore.use.shadCnContainterRef();
  return <div ref={shadCnContainterRef} />;
};
