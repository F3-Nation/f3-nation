"use client";

import { ModalType, openModal } from "~/utils/store/modal";
import { VersionInfo } from "../version-info";

export default function WithLove() {
  return (
    <div className="my-[1px] flex flex-row items-center justify-center gap-4">
      <div className="flex gap-2 whitespace-nowrap text-xs text-foreground opacity-60">
        <VersionInfo className="text-center text-xs text-foreground/60" />
        <button
          className="text-foreground underline underline-offset-2"
          onClick={() => {
            openModal(ModalType.ABOUT_MAP);
          }}
        >
          <span className="cursor-pointer text-blue-600 underline underline-offset-2">
            About this map
          </span>
        </button>{" "}
        <button
          className="text-foreground underline underline-offset-2"
          onClick={() => {
            openModal(ModalType.MAP_HELP);
          }}
        >
          <span className="cursor-pointer text-blue-600 underline underline-offset-2">
            Help
          </span>
        </button>
      </div>
    </div>
  );
}
