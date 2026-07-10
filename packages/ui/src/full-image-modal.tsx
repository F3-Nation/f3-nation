"use client";

import { Z_INDEX } from "@acme/shared/app/constants";

import { cn } from ".";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { ImageWithFallback } from "./image-with-fallback";

export interface FullImageModalData {
  title: string;
  src: string;
  fallbackSrc: string;
  alt: string;
}

export const FullImageModal = ({
  data,
  onClose,
}: {
  data: FullImageModalData;
  onClose: () => void;
}) => {
  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
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
