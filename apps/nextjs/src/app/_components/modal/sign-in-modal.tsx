"use client";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import type { DataType, ModalType } from "~/utils/store/modal";
import { AuthContent } from "~/app/auth/components/auth-components";
import { closeModal } from "~/utils/store/modal";

export default function SignInModal({
  data,
}: {
  data: DataType[ModalType.SIGN_IN];
}) {
  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.DIALOG_CONTENT }}
        className={cn(`max-w-[90%] rounded-lg md:max-w-[450px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            Sign in to F3 Nation
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col px-6 py-2">
          <AuthContent callbackUrl={data.callbackUrl} withWrapper={false} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
