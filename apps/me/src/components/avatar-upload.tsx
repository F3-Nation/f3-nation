"use client";

import { useRef } from "react";
import { cn } from "@acme/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@acme/ui/avatar";
import { Button } from "@acme/ui/button";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";

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
  const trimmedName = fallbackName?.trim();
  const initial = (trimmedName?.length ? trimmedName : "F3")
    .charAt(0)
    .toUpperCase();

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
        <Avatar className={cn("h-20 w-20", uploading && "opacity-50")}>
          <AvatarImage
            src={previewUrl ?? undefined}
            alt=""
            className="object-cover"
          />
          <AvatarFallback className="bg-slate-700 text-[32px] text-white dark:bg-slate-700">
            {initial}
          </AvatarFallback>
        </Avatar>
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
