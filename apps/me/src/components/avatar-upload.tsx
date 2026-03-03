"use client";

import { useRef, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

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
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleUpload = useCallback(
    async (file: File) => {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Maximum file size is 5MB.",
          variant: "destructive",
        });
        return;
      }

      if (
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          file.type,
        )
      ) {
        toast({
          title: "Invalid file type",
          description: "Please upload a JPEG, PNG, WebP, or GIF image.",
          variant: "destructive",
        });
        return;
      }

      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/profile/avatar", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? "Upload failed");
        }

        const data = await res.json();
        setPreviewUrl(data.avatarUrl);
        onUploaded(data.avatarUrl);
        toast({
          title: "Avatar updated",
          description: "Your avatar has been saved.",
        });
      } catch (err) {
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [onUploaded, toast],
  );

  return (
    <div className="flex items-center gap-4">
      <div
        className={`relative cursor-pointer rounded-full ${dragOver ? "ring-2 ring-primary ring-offset-2" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleUpload(file);
        }}
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
      </div>
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading..." : "Change avatar"}
        </Button>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP, or GIF. Max 5MB.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />
    </div>
  );
}
