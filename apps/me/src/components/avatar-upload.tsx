"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { cn } from "@/lib/utils";

interface AvatarUploadProps {
  currentUrl: string | null;
  fallbackName?: string;
  onUploaded: (url: string) => void;
}

export function AvatarUpload({
  currentUrl,
  fallbackName,
  onUploaded,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    uploading,
    previewUrl,
    dragOver,
    setDragOver,
    handleDrop,
    handleFileChange,
  } = useAvatarUpload({ currentUrl, onUploaded });

  const openFilePicker = () => inputRef.current?.click();

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        className={cn(
          "relative cursor-pointer rounded-full",
          dragOver && "ring-2 ring-primary ring-offset-2",
        )}
        onClick={openFilePicker}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <Avatar
          src={previewUrl}
          fallback={fallbackName}
          size="lg"
          className={uploading ? "opacity-50" : ""}
        />
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}
      </button>
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={openFilePicker}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Change avatar"}
        </Button>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, or WebP. Max 5MB. Will be converted to JPEG.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
