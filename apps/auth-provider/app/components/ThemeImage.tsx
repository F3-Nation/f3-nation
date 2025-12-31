'use client';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useState, useEffect } from 'react';

export default function ThemeImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted before accessing theme to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // If src is already a full URL (like from Google auth), use it directly
  if (src.startsWith('http')) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        priority={priority}
      />
    );
  }

  // Before mounting, always use the light theme version to match SSR
  if (!mounted) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        priority={priority}
      />
    );
  }

  // After mounting, use the actual theme
  const currentTheme = theme === 'system' ? systemTheme : theme;

  return (
    <Image
      src={currentTheme === 'dark' ? src.replace('.svg', '-white.svg') : src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  );
}
