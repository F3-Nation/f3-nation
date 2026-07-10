"use client";

import type { ReactNode } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";

import { cn } from ".";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";

export default function SignInModal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.DIALOG_CONTENT }}
        className={cn(`max-w-[90%] rounded-lg md:max-w-[450px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            Sign in to F3 Nation
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col px-6 py-2">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
