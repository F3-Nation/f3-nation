'use client';
import Image from 'next/image';
import { useTheme } from 'next-themes';

export default function Logo({
  src = '/f3nation.svg',
  alt = 'F3 Nation Logo',
  width = 40,
  height = 40,
  className,
  priority = false,
}: {
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const { theme, systemTheme } = useTheme();
  const currentTheme = theme === 'system' ? systemTheme : theme;

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
