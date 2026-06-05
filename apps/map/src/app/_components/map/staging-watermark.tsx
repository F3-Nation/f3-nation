import { Case } from "@acme/shared/common/enums";
import { convertCase } from "@acme/shared/common/functions";

export const StagingWatermark = () => {
  const channel = window.__F3_RUNTIME__?.channel ?? "";
  if (channel === "prod") return null;
  return (
    <div className="z-10 m-2 w-max rounded-md bg-background/70 p-1 px-2 text-xs text-foreground">
      WARNING:{" "}
      {convertCase({
        str: channel,
        toCase: Case.TitleCase,
        fromCase: Case.LowerCase,
      })}{" "}
      site. Data may be stale / fake
    </div>
  );
};
