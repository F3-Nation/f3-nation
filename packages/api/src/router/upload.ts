import sharp from "sharp";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import { env } from "@acme/env";

import { apiKeyProcedure } from "../shared";

// Constants matching Python implementation
const LOW_RES_IMAGE_SIZE = 480;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB limit
const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];

/**
 * Initialize Google Auth client for GCS uploads.
 * Reuses the same credentials as the logo bucket.
 */
const getGcsAuthClient = async () => {
  const auth = new GoogleAuth({
    credentials: {
      private_key: env.GOOGLE_LOGO_BUCKET_PRIVATE_KEY.replace(
        /\\\n/g,
        "\n",
      ).replace(/\\n/g, "\n"),
      client_email: env.GOOGLE_LOGO_BUCKET_CLIENT_EMAIL,
    },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  return auth.getClient();
};

/**
 * Upload a buffer to GCS and return the public URL.
 */
const uploadToGcs = async (
  buffer: Buffer,
  filename: string,
  contentType: string,
  bucket: string,
): Promise<string> => {
  const client = await getGcsAuthClient();
  const token = await client.getAccessToken();

  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": contentType,
      },
      body: buffer,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload to GCS: ${response.status} ${text}`);
  }

  return `https://storage.googleapis.com/${bucket}/${filename}`;
};

/**
 * Download a file from a Slack URL using the bot token.
 */
const downloadFromSlack = async (
  url: string,
  slackToken: string,
): Promise<Buffer> => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${slackToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download from Slack: ${response.status} ${response.statusText}`,
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large: ${contentLength} bytes (max: ${MAX_FILE_SIZE_BYTES})`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
};

/**
 * Process an image buffer with sharp:
 * - Convert HEIC/HEIF to PNG
 * - Optionally enforce square aspect ratio (with black padding)
 * - Optionally resize to max height
 */
const processImage = async (
  buffer: Buffer,
  options: {
    filetype: string;
    enforceSquare?: boolean;
    maxHeight?: number;
  },
): Promise<{ buffer: Buffer; format: "png" | "jpeg" | "webp" | "gif" }> => {
  let image = sharp(buffer);
  const metadata = await image.metadata();

  // Determine output format
  let outputFormat: "png" | "jpeg" | "webp" | "gif" = "png";
  const inputFormat = options.filetype.toLowerCase();

  // Convert HEIC/HEIF to PNG, otherwise preserve format when possible
  if (inputFormat === "heic" || inputFormat === "heif") {
    outputFormat = "png";
  } else if (inputFormat === "jpeg" || inputFormat === "jpg") {
    outputFormat = "jpeg";
  } else if (inputFormat === "webp") {
    outputFormat = "webp";
  } else if (inputFormat === "gif") {
    outputFormat = "gif";
  }

  // Enforce square aspect ratio by extending canvas with black background
  if (options.enforceSquare && metadata.width && metadata.height) {
    const maxSide = Math.max(metadata.width, metadata.height);
    const padLeft = Math.floor((maxSide - metadata.width) / 2);
    const padTop = Math.floor((maxSide - metadata.height) / 2);

    image = image.extend({
      top: padTop,
      bottom: maxSide - metadata.height - padTop,
      left: padLeft,
      right: maxSide - metadata.width - padLeft,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    });
  }

  // Resize to max height if specified (maintaining aspect ratio)
  if (options.maxHeight) {
    image = image.resize({
      height: options.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Convert to output format
  switch (outputFormat) {
    case "jpeg":
      image = image.jpeg({ quality: 95 });
      break;
    case "webp":
      image = image.webp({ quality: 95 });
      break;
    case "gif":
      image = image.gif();
      break;
    default:
      image = image.png({ compressionLevel: 6 });
  }

  const processedBuffer = await image.toBuffer();
  return { buffer: processedBuffer, format: outputFormat };
};

/**
 * Generate a thumbnail version of an image.
 */
const generateThumbnail = async (
  buffer: Buffer,
  size: number = LOW_RES_IMAGE_SIZE,
): Promise<Buffer> => {
  return sharp(buffer)
    .resize({
      width: size,
      height: size,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 6 })
    .toBuffer();
};

// Input schema for Slack file upload
const slackFileInputSchema = z.object({
  slackFileUrl: z.string().url().describe("Slack file URL (url_private_download)"),
  slackToken: z.string().min(1).describe("Slack bot token for authentication"),
  fileId: z.string().min(1).describe("Slack file ID (used in filename)"),
  filetype: z.string().min(1).describe("File extension (e.g., 'png', 'heic')"),
  mimetype: z.string().min(1).describe("MIME type (e.g., 'image/png')"),
  enforceSquare: z
    .boolean()
    .optional()
    .default(false)
    .describe("Extend canvas to square with black padding"),
  maxHeight: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum height in pixels (maintains aspect ratio)"),
  generateThumbnail: z
    .boolean()
    .optional()
    .default(true)
    .describe("Generate a low-res thumbnail version"),
  bucket: z
    .string()
    .optional()
    .describe("GCS bucket name (defaults to backblast-images)"),
});

// Output schema for Slack file upload
const slackFileOutputSchema = z.object({
  url: z.string().url().describe("Full-resolution image URL"),
  thumbnailUrl: z.string().url().nullable().describe("Thumbnail image URL (if generated)"),
  fileId: z.string().describe("Original Slack file ID"),
});

export const uploadRouter = {
  /**
   * Upload a file from Slack to GCS with optional image processing.
   *
   * This endpoint:
   * 1. Downloads the file from Slack using the provided bot token
   * 2. Validates it's a supported image type
   * 3. Optionally processes the image (square padding, resize, format conversion)
   * 4. Uploads to GCS (full res and optional thumbnail)
   * 5. Returns public URLs for the uploaded files
   */
  slackFile: apiKeyProcedure
    .input(slackFileInputSchema)
    .output(slackFileOutputSchema)
    .route({
      method: "POST",
      path: "/slack-file",
      tags: ["upload"],
      summary: "Upload a Slack file to GCS",
      description:
        "Downloads an image from Slack, processes it, and uploads to Google Cloud Storage",
    })
    .handler(async ({ input }) => {
      const bucket = input.bucket ?? env.GCS_BACKBLAST_BUCKET_NAME;

      // Validate mime type
      if (!SUPPORTED_IMAGE_TYPES.includes(input.mimetype.toLowerCase())) {
        throw new Error(
          `Unsupported image type: ${input.mimetype}. Supported: ${SUPPORTED_IMAGE_TYPES.join(", ")}`,
        );
      }

      // Download from Slack
      const originalBuffer = await downloadFromSlack(
        input.slackFileUrl,
        input.slackToken,
      );

      // Process the image
      const { buffer: processedBuffer, format } = await processImage(
        originalBuffer,
        {
          filetype: input.filetype,
          enforceSquare: input.enforceSquare,
          maxHeight: input.maxHeight,
        },
      );

      // Determine filenames and content type
      const filename = `${input.fileId}.${format}`;
      const contentType = `image/${format}`;

      // Upload full-res image
      const url = await uploadToGcs(
        processedBuffer,
        filename,
        contentType,
        bucket,
      );

      // Generate and upload thumbnail if requested
      let thumbnailUrl: string | null = null;
      if (input.generateThumbnail) {
        const thumbnailBuffer = await generateThumbnail(processedBuffer);
        const thumbnailFilename = `${input.fileId}_low_res.png`;
        thumbnailUrl = await uploadToGcs(
          thumbnailBuffer,
          thumbnailFilename,
          "image/png",
          bucket,
        );
      }

      return {
        url,
        thumbnailUrl,
        fileId: input.fileId,
      };
    }),

  /**
   * Upload multiple Slack files in a batch.
   * Processes files in parallel for efficiency.
   */
  slackFiles: apiKeyProcedure
    .input(
      z.object({
        files: z.array(slackFileInputSchema).max(10),
      }),
    )
    .output(
      z.object({
        results: z.array(
          z.union([
            slackFileOutputSchema,
            z.object({
              fileId: z.string(),
              error: z.string(),
            }),
          ]),
        ),
      }),
    )
    .route({
      method: "POST",
      path: "/slack-files",
      tags: ["upload"],
      summary: "Upload multiple Slack files to GCS",
      description:
        "Batch upload multiple images from Slack to Google Cloud Storage",
    })
    .handler(async ({ input }) => {
      const results = await Promise.all(
        input.files.map(async (file) => {
          try {
            const bucket = file.bucket ?? env.GCS_BACKBLAST_BUCKET_NAME;

            // Validate mime type
            if (
              !SUPPORTED_IMAGE_TYPES.includes(file.mimetype.toLowerCase())
            ) {
              return {
                fileId: file.fileId,
                error: `Unsupported image type: ${file.mimetype}`,
              };
            }

            // Download from Slack
            const originalBuffer = await downloadFromSlack(
              file.slackFileUrl,
              file.slackToken,
            );

            // Process the image
            const { buffer: processedBuffer, format } = await processImage(
              originalBuffer,
              {
                filetype: file.filetype,
                enforceSquare: file.enforceSquare,
                maxHeight: file.maxHeight,
              },
            );

            // Upload full-res image
            const filename = `${file.fileId}.${format}`;
            const contentType = `image/${format}`;
            const url = await uploadToGcs(
              processedBuffer,
              filename,
              contentType,
              bucket,
            );

            // Generate and upload thumbnail if requested
            let thumbnailUrl: string | null = null;
            if (file.generateThumbnail !== false) {
              const thumbnailBuffer = await generateThumbnail(processedBuffer);
              const thumbnailFilename = `${file.fileId}_low_res.png`;
              thumbnailUrl = await uploadToGcs(
                thumbnailBuffer,
                thumbnailFilename,
                "image/png",
                bucket,
              );
            }

            return {
              url,
              thumbnailUrl,
              fileId: file.fileId,
            };
          } catch (error) {
            return {
              fileId: file.fileId,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      return { results };
    }),
};
