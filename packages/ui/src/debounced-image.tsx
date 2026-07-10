"use client";

import type { DetailedHTMLProps, ImgHTMLAttributes } from "react";
import { useEffect, useState } from "react";

export function DebouncedImage({
  src,
  alt,
  onImageFail,
  onImageSuccess,
}: Omit<
  DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>,
  "src"
> & {
  src?: string;
  onImageFail: () => void;
  onImageSuccess: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => {
      setLoading(false);
      setImage(src);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [src]);
  return loading ? (
    <div className="size-16 animate-pulse rounded-md bg-gray-200" />
  ) : image ? (
    <img
      src={image}
      width={64}
      height={64}
      alt={alt}
      onError={onImageFail}
      onLoad={onImageSuccess}
    />
  ) : null;
}
