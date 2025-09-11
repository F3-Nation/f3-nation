import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";

import type { DataType, ModalType } from "~/utils/store/modal";
import { closeModal } from "~/utils/store/modal";
import { ImageWithFallback } from "../image-with-fallback";

export const FullImageModal = ({
  data,
}: {
  data: DataType[ModalType.FULL_IMAGE];
}) => {
  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {data.title ?? "Logo"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center">
          <ImageWithFallback
            src={data.src}
            fallbackSrc={data.fallbackSrc}
            alt={data.alt}
            className="max-h-[70vh] w-auto rounded-lg"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
