/* eslint-disable @next/next/no-img-element */
/* eslint-disable jsx-a11y/alt-text */
import type { ComponentProps } from "react";
import { useState } from "react";

import { cn } from "@acme/ui";

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
      // Had issue with png suffix. It is automatically added now
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
