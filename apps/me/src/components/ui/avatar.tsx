import * as React from "react";
import Image from "next/image";
import { cn, getFallbackAvatar } from "@/lib/utils";

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

const sizePx = {
  sm: 32,
  md: 48,
  lg: 80,
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

  React.useEffect(() => {
    setImgError(false);
  }, [src]);

  const showFallback = !src || imgError;
  const px = sizePx[size];

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
        // Fallback is a data URI SVG — use unoptimized since it's inline
        <Image
          src={getFallbackAvatar(fallback)}
          alt={alt}
          width={px}
          height={px}
          className="aspect-square h-full w-full"
          unoptimized
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          width={px}
          height={px}
          className="aspect-square h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      )}
    </span>
  );
}

export { Avatar };
