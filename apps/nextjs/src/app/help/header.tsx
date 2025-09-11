"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { cn } from "@acme/ui";

import { F3Logo } from "../_components/map/f3-logo";

export const Header = () => {
  const back = useSearchParams()?.get("back");

  return (
    <div className="flex items-center gap-4">
      {back ? (
        <Link href={back} className={cn("test")}>
          <ArrowLeft />
        </Link>
      ) : null}
      <F3Logo />
      <div className="flex flex-col">
        <div className="text-3xl font-bold">Nation Map</div>
        <div className="text-sm text-muted-foreground">
          We want to continually improve the map, so please let us know about
          any issues or ideas you have
        </div>
      </div>
    </div>
  );
};
