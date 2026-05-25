import sharp from "sharp";

export interface ResizeImageOptions {
  width: number;
  height: number;
  /** JPEG quality 1-100. Defaults to 85. */
  quality?: number;
}

/**
 * Resize an image to the given dimensions and convert to JPEG.
 * Uses cover fit (center-crop) and strips metadata.
 */
export async function resizeImage(
  data: Buffer,
  options: ResizeImageOptions,
): Promise<Buffer> {
  try {
    return await sharp(data)
      .resize(options.width, options.height, {
        fit: "cover",
        withoutEnlargement: true,
      })
      .jpeg({ quality: options.quality ?? 85 })
      .toBuffer();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown image error";
    throw new Error(`Failed to process image: ${message}`);
  }
}
