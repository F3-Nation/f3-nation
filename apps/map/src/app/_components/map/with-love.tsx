"use client";

import { ModalType, openModal } from "~/utils/store/modal";
import { VersionInfo } from "../version-info";

export default function WithLove() {
  return (
    <div className="flex flex-row items-center gap-3 border-t px-4 py-2 text-[11px] whitespace-nowrap text-muted-foreground">
      <VersionInfo className="text-[11px] text-muted-foreground" />
      <button
        className="underline underline-offset-2 hover:text-foreground"
        onClick={() => {
          openModal(ModalType.ABOUT_MAP);
        }}
      >
        About this map
      </button>
      <button
        className="underline underline-offset-2 hover:text-foreground"
        onClick={() => {
          openModal(ModalType.MAP_HELP);
        }}
      >
        Help
      </button>
    </div>
  );
}
