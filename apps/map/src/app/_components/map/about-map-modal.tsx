"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";

import { BOONE_CENTER, Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import { setView } from "~/utils/set-view";
import { closeModal, ModalType, openModal } from "~/utils/store/modal";

export function AboutMapModal() {
  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[400px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-tight">
            About This Map
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-6">
          <p className="leading-relaxed text-muted-foreground">
            This map was built with ❤️️️ by{" "}
            <Link
              target="_blank"
              href="https://linkedin.com/in/declan-nishiyama"
              className="font-medium text-primary hover:underline"
            >
              Spuds
            </Link>{" "}
            who runs{" "}
            <Link
              target="_blank"
              href="https://mountaindev.com"
              className="font-medium text-primary hover:underline"
            >
              Mountain Dev
            </Link>
            , a full stack development studio
          </p>
          <p className="leading-relaxed text-muted-foreground">
            He's in{" "}
            <button
              className="font-medium text-primary hover:underline"
              onClick={() => {
                closeModal(undefined, "all");
                setView({ lat: BOONE_CENTER[0], lng: BOONE_CENTER[1] });
              }}
            >
              F3 Boone
            </button>{" "}
            and created this map to give back to the community.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Shout out to Tackle — IT Director extraordinaire — and all the
            people of F3 IT for making this happen!
          </p>
        </div>
        <button
          className="group flex w-full flex-row items-center justify-center gap-2.5 rounded-lg bg-primary/10 p-3 font-medium transition-colors hover:bg-primary/20"
          onClick={() => {
            openModal(ModalType.MAP_HELP);
          }}
        >
          <CircleHelp className="size-4 text-primary" />
          <span className="text-sm text-primary">Need Help?</span>
        </button>
      </DialogContent>
    </Dialog>
  );
}
