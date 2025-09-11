"use client";

import Image from "next/image";
import Link from "next/link";

import { BreakPoints } from "@acme/shared/app/constants";

import { Responsive } from "~/utils/responsive";

// 50 pixel offset so header doesn't get funky as screen size shrinks
const LOGO_CHANGE_OFFSET = 50;
export const Logo = () => {
  return (
    <Link href={`/`}>
      <Responsive maxWidth={BreakPoints.MD + LOGO_CHANGE_OFFSET}>
        <Image
          src={`/f3_logo.png`}
          alt="F3 Nation Logo"
          width={150}
          height={50}
          className="h-full w-auto object-contain"
        />
      </Responsive>
      <Responsive minWidth={BreakPoints.MD + LOGO_CHANGE_OFFSET}>
        <Image
          src={`/f3_logo.png`}
          alt="F3 Nation Logo"
          width={200}
          height={50}
          className="h-full w-auto object-contain"
        />
      </Responsive>
    </Link>
  );
};
