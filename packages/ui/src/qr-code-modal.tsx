"use client";

import type { ComponentProps } from "react";
import { useRef } from "react";
import ReactQRCode from "react-qr-code";

import { Z_INDEX } from "@acme/shared/app/constants";

import { cn } from ".";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";

export interface QRCodeModalData {
  url: string;
  fileName: string;
  title: string;
}

// react-qr-code's d.ts mistypes the component as a class; at runtime it forwards its ref to the <svg>
const QRCode = ReactQRCode as unknown as React.FC<
  Omit<ComponentProps<typeof ReactQRCode>, "ref"> & {
    ref?: React.Ref<SVGSVGElement>;
  }
>;

const toBase64 = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)));

export const QRCodeModal = ({
  data,
  onClose,
}: {
  data: QRCodeModalData;
  onClose: () => void;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  // https://github.com/rosskhanas/react-qr-code/blob/master/demo/src/components/App.js
  const onImageDownload = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL("image/png");
      const downloadLink = document.createElement("a");
      downloadLink.download = data.fileName;
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    img.onerror = () => {
      console.error("Failed to render QR code SVG for download");
    };
    img.src = `data:image/svg+xml;base64,${toBase64(svgData)}`;
  };

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
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
            ref={svgRef}
            size={256}
            style={{ height: "256", maxWidth: "100%", width: "100%" }}
            value={data.url}
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
