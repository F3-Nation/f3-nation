import * as React from "react";
import { cn } from "@/lib/utils";
import { getFallbackAvatar } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-20 w-20",
};

function Avatar({
  className,
  src,
  alt = "",
  fallback,
  size = "md",
  ...props
}: AvatarProps) {
  const [imgError, setImgError] = React.useState(false);

  const showFallback = !src || imgError;

  return (
    <span
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-full",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {showFallback ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getFallbackAvatar(fallback)}
          alt={alt}
          className="aspect-square h-full w-full"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="aspect-square h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      )}
    </span>
  );
}

export { Avatar };
