"use client";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import type { DataType, ModalType } from "~/utils/store/modal";
import { closeModal } from "~/utils/store/modal";

export default function DeleteModal({
  data,
}: {
  data: DataType[ModalType.DELETE_CONFIRMATION];
}) {
  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[400px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            Delete {data.type.toLowerCase()}
          </DialogTitle>
        </DialogHeader>

        <div className="my-6 w-full px-3">
          {`Are you sure you want to delete this ${data.type.toLowerCase()}?`}
        </div>
        <div className="mb-2 w-full px-2">
          <div className="flex space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => closeModal()}
              className="w-full"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="w-full"
              onClick={() => data.onConfirm()}
            >
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
