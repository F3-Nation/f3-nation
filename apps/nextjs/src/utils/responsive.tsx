"use client";

import type { ComponentProps } from "react";
import dynamic from "next/dynamic";

const MediaQuery = dynamic(() => import("react-responsive"), {
  ssr: false,
});

export const Responsive = (
  props: Omit<ComponentProps<typeof MediaQuery>, "maxWidth" | "minWidth"> & {
    maxWidth?: number;
    minWidth?: number;
  },
) => (
  <MediaQuery
    {...props}
    maxWidth={props.maxWidth !== undefined ? props.maxWidth - 1 : undefined}
    minWidth={props.minWidth}
  />
);
