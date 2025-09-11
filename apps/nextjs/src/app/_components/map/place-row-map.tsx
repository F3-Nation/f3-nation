import { MapPin } from "lucide-react";

import { cn } from "@acme/ui";
import { CardDescription, CardHeader, CardTitle } from "@acme/ui/card";

import type { GeoMapSearchResult } from "~/utils/types";
import { onClickPlaceRowMap } from "~/utils/on-click-place-row-map";

export const PlaceRowMap = ({
  result,
  focused,
}: {
  result: GeoMapSearchResult;
  focused?: boolean;
}) => {
  return (
    <button
      className="w-full"
      onClick={() => {
        onClickPlaceRowMap(result);
      }}
    >
      <CardHeader
        className={cn("flex-row items-center gap-2 p-2 hover:bg-foreground/5", {
          "bg-foreground/5": focused,
        })}
      >
        <div className="flex-shrink-0">
          <MapPin />
        </div>
        <div className="flex-4 text-left">
          <CardTitle>{result.header}</CardTitle>
          <CardDescription className="line-clamp-1">
            {result.description}
          </CardDescription>
        </div>
      </CardHeader>
    </button>
  );
};
