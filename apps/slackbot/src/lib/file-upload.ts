/**
 * File Upload Utilities
 *
 * Provides convenience functions for uploading Slack files to GCS.
 * Used by features like backblast and preblast that accept image attachments.
 */

import type {
  SlackFileUploadInput,
  SlackFileUploadResponse,
  SlackFilesUploadResponse,
} from "../types/api-types";
import { api } from "./api-client";
import { logger } from "./logger";

/**
 * Slack file object from form submission (from file input element)
 */
export interface SlackFile {
  id: string;
  /** URL requiring Slack auth - use for downloading full file */
  url_private_download?: string;
  /** Alternative URL key sometimes present */
  url_private?: string;
  /** File extension without dot (e.g., "png", "heic") */
  filetype?: string;
  /** MIME type (e.g., "image/png") */
  mimetype?: string;
  /** Original filename */
  name?: string;
}

/**
 * Options for file upload processing
 */
export interface UploadOptions {
  /** Extend canvas to square with black padding */
  enforceSquare?: boolean;
  /** Maximum height in pixels (maintains aspect ratio) */
  maxHeight?: number;
  /** Generate a low-res thumbnail version (default: true) */
  generateThumbnail?: boolean;
  /** Override the default GCS bucket */
  bucket?: string;
}

/**
 * Result from uploading multiple files
 */
export interface UploadFilesResult {
  /** Full-resolution URLs for all successfully uploaded files */
  urls: string[];
  /** Thumbnail URLs (only for files where thumbnail was generated) */
  thumbnailUrls: string[];
  /** Original Slack file IDs that were uploaded */
  fileIds: string[];
  /** Any errors that occurred during upload */
  errors: { fileId: string; error: string }[];
}

/**
 * Upload multiple Slack files to GCS.
 *
 * This function:
 * 1. Extracts file metadata from Slack file objects
 * 2. Gets the bot token from the Slack space
 * 3. Calls the API to download, process, and upload each file
 * 4. Returns URLs for the uploaded files
 *
 * @param files - Array of Slack file objects from form submission
 * @param botToken - Slack bot token for downloading files
 * @param options - Optional processing options (square, maxHeight, etc.)
 * @returns Upload results with URLs and any errors
 *
 * @example
 * ```typescript
 * const fileObjects = safeGet(values, ACTIONS.BACKBLAST_FILE, ACTIONS.BACKBLAST_FILE, "files") ?? [];
 * const botToken = space.botToken;
 * const result = await uploadSlackFiles(fileObjects, botToken, { enforceSquare: true });
 * // result.urls contains the GCS URLs for the uploaded images
 * ```
 */
export async function uploadSlackFiles(
  files: SlackFile[],
  botToken: string,
  options?: UploadOptions,
): Promise<UploadFilesResult> {
  const result: UploadFilesResult = {
    urls: [],
    thumbnailUrls: [],
    fileIds: [],
    errors: [],
  };

  if (!files || files.length === 0) {
    return result;
  }

  if (!botToken) {
    logger.error("No bot token provided for file upload");
    return {
      ...result,
      errors: files.map((f) => ({
        fileId: f.id,
        error: "No bot token available",
      })),
    };
  }

  // Build upload inputs for all files
  const uploadInputs: SlackFileUploadInput[] = files
    .filter((file) => {
      // Validate required fields
      const downloadUrl = file.url_private_download ?? file.url_private;
      if (!downloadUrl) {
        result.errors.push({
          fileId: file.id,
          error: "No download URL available",
        });
        return false;
      }
      if (!file.mimetype) {
        result.errors.push({
          fileId: file.id,
          error: "No mimetype available",
        });
        return false;
      }
      return true;
    })
    .map((file) => ({
      slackFileUrl: (file.url_private_download ?? file.url_private)!,
      slackToken: botToken,
      fileId: file.id,
      filetype: file.filetype ?? "png",
      mimetype: file.mimetype!,
      enforceSquare: options?.enforceSquare,
      maxHeight: options?.maxHeight,
      generateThumbnail: options?.generateThumbnail ?? true,
      bucket: options?.bucket,
    }));

  if (uploadInputs.length === 0) {
    logger.debug("uploadSlackFiles: No valid inputs after filtering", {
      originalCount: files.length,
      errorsCount: result.errors.length,
    });
    return result;
  }

  logger.debug("uploadSlackFiles: Attempting upload", {
    inputsCount: uploadInputs.length,
    fileIds: uploadInputs.map((i) => i.fileId),
  });

  try {
    // Use batch upload for multiple files
    if (uploadInputs.length > 1) {
      const response: SlackFilesUploadResponse = await api.upload.slackFiles({
        files: uploadInputs,
      });

      for (const item of response.results) {
        if ("error" in item) {
          result.errors.push({
            fileId: item.fileId,
            error: item.error,
          });
        } else {
          result.urls.push(item.url);
          result.fileIds.push(item.fileId);
          if (item.thumbnailUrl) {
            result.thumbnailUrls.push(item.thumbnailUrl);
          }
        }
      }
    } else {
      // Single file - use individual upload endpoint
      const input: SlackFileUploadInput = uploadInputs[0]!;
      try {
        logger.debug("uploadSlackFiles: Calling API for single file", {
          fileId: input.fileId,
          slackFileUrl: input.slackFileUrl?.substring(0, 50) + "...",
          mimetype: input.mimetype,
        });
        const response: SlackFileUploadResponse =
          await api.upload.slackFile(input);
        logger.debug("uploadSlackFiles: API response received", {
          fileId: response.fileId,
          url: response.url,
          thumbnailUrl: response.thumbnailUrl,
        });
        result.urls.push(response.url);
        result.fileIds.push(response.fileId);
        if (response.thumbnailUrl) {
          result.thumbnailUrls.push(response.thumbnailUrl);
        }
      } catch (error) {
        logger.error("uploadSlackFiles: Single file upload failed", {
          fileId: input.fileId,
          error,
        });
        result.errors.push({
          fileId: input.fileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    // Batch upload failed entirely - mark all files as errored
    logger.error("Batch file upload failed", error);
    for (const input of uploadInputs) {
      result.errors.push({
        fileId: input.fileId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Upload a single Slack file to GCS.
 *
 * Convenience wrapper around uploadSlackFiles for single file uploads.
 *
 * @param file - Single Slack file object
 * @param botToken - Slack bot token
 * @param options - Processing options
 * @returns Upload result or null if failed
 */
export async function uploadSlackFile(
  file: SlackFile,
  botToken: string,
  options?: UploadOptions,
): Promise<{ url: string; thumbnailUrl: string | null } | null> {
  const result = await uploadSlackFiles([file], botToken, options);

  if (result.errors.length > 0) {
    logger.error(`File upload failed: ${result.errors[0]?.error}`);
    return null;
  }

  if (result.urls.length === 0) {
    return null;
  }

  return {
    url: result.urls[0]!,
    thumbnailUrl: result.thumbnailUrls[0] ?? null,
  };
}

/**
 * Extract file objects from Slack view state values.
 *
 * Helper to safely extract file array from form submission values.
 *
 * @param values - Slack view state values
 * @param actionId - Action ID of the file input
 * @returns Array of Slack file objects
 */
export function extractFilesFromValues(
  values: Record<string, Record<string, { files?: SlackFile[] }>>,
  actionId: string,
): SlackFile[] {
  return values?.[actionId]?.[actionId]?.files ?? [];
}
