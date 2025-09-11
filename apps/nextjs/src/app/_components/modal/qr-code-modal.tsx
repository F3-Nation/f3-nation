import QRCode from "react-qr-code";

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

export const QRCodeModal = ({
  data,
}: {
  data: DataType[ModalType.QR_CODE];
}) => {
  // https://github.com/rosskhanas/react-qr-code/blob/master/demo/src/components/App.js
  const onImageDownload = () => {
    const svg = document.getElementById("QRCode");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");
      const downloadLink = document.createElement("a");
      downloadLink.download = data.fileName ?? "QRCode";
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(svgData)}`;
  };

  return (
    <Dialog open={true} onOpenChange={() => closeModal()}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[600px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">
            {`${data.title} QR Code`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center">
          <QRCode
            id="QRCode"
            size={256}
            style={{ height: "256", maxWidth: "100%", width: "100%" }}
            // We know that url is not null because of the check above
            value={data.url ?? ""}
            viewBox={`0 0 256 256`}
          />
          {/* Pretty button */}
          <button
            className="bg-ht-yellow mt-4 cursor-pointer rounded-md px-4 py-2"
            onClick={onImageDownload}
          >
            Download
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
