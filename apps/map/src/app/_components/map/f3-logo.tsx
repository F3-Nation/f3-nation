import type { LinkProps } from "next/link";
import Image from "next/image";
import Link from "next/link";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

export const F3Logo = ({
  className,
  ...rest
}: Partial<LinkProps> & { className?: string }) => {
  return (
    <Link
      href="https://f3nation.com/"
      target="_blank"
      className={cn("-m-2 transition-all", className)}
      style={{ zIndex: Z_INDEX.F3_LOGO }}
      {...rest}
    >
      <Image
        src="/f3_logo.png"
        alt="F3 Logo"
        width={64}
        height={64}
        className="rounded-lg"
      />
    </Link>
  );
};
