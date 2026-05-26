"use client";

/* eslint-disable jsx-a11y/alt-text */
import type { ComponentProps } from "react";
import { useState } from "react";

import { cn } from ".";

export const ImageWithFallback = ({
  src,
  fallbackSrc,
  onError,
  className,
  ...props
}: ComponentProps<"img"> & {
  fallbackSrc?: ComponentProps<"img">["src"];
}) => {
  const [hasError, setHasError] = useState(false);
  return (
    <img
      // https://github.com/facebook/react-native/pull/42237/commits/85abdcde07dc4de775f241e915fbcd583897e1e7
      src={hasError && fallbackSrc ? fallbackSrc : src}
      onError={(err) => {
        setHasError(true);
        onError?.(err);
      }}
      className={cn("bg-black", className)}
      {...props}
    />
  );
};
