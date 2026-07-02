import type { DetailedHTMLProps, ImgHTMLAttributes } from "react";
import { useEffect, useState } from "react";

export function DebouncedImage({
  src,
  alt,
  onImageFail,
  onImageSuccess,
}: DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement> & {
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
    // eslint-disable-next-line @next/next/no-img-element
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
