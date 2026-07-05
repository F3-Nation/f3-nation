import { useState, useCallback, useEffect } from "react";

import { toast } from "@acme/ui/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AvatarUploadOptions {
  currentUrl: string | null;
  onUploaded: (url: string) => void;
}

export interface UseAvatarUploadReturn {
  uploading: boolean;
  previewUrl: string | null;
  dragOver: boolean;
  handleUpload: (file: File) => Promise<void>;
  setDragOver: (v: boolean) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

export interface FileValidationError {
  title: string;
  description: string;
}

/** Validate a file for avatar upload. Returns an error object or null. */
export function validateAvatarFile(file: File): FileValidationError | null {
  if (file.size === 0) {
    return {
      title: "Empty file",
      description: "The selected file is empty.",
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      title: "File too large",
      description: "Maximum file size is 5MB.",
    };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      title: "Invalid file type",
      description: "Please upload a JPEG, PNG, or WebP image.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAvatarUpload({
  currentUrl,
  onUploaded,
}: AvatarUploadOptions): UseAvatarUploadReturn {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setPreviewUrl(currentUrl);
  }, [currentUrl]);

  const handleUpload = useCallback(
    async (file: File) => {
      const validationError = validateAvatarFile(file);
      if (validationError) {
        toast.error(validationError.title, {
          description: validationError.description,
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
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? "Upload failed");
        }

        const data = (await res.json()) as { avatarUrl: string };
        setPreviewUrl(data.avatarUrl);
        onUploaded(data.avatarUrl);
        toast.success("Avatar updated", {
          description: "Your avatar has been saved.",
        });
      } catch (err) {
        toast.error("Upload failed", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
      } finally {
        setUploading(false);
      }
    },
    [onUploaded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleUpload(file);
    },
    [handleUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleUpload(file);
    },
    [handleUpload],
  );

  return {
    uploading,
    previewUrl,
    dragOver,
    handleUpload,
    setDragOver,
    handleDrop,
    handleFileChange,
  };
}
