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
 *
 * `.rotate()` (no angle) auto-applies the source EXIF Orientation before the
 * crop, so portrait photos from phones (stored as landscape pixels + an
 * orientation flag) are processed upright rather than rotated 90°. Must run
 * before `.resize()`. See #315.
 */
export async function resizeImage(
  data: Buffer,
  options: ResizeImageOptions,
): Promise<Buffer> {
  try {
    return await sharp(data)
      .rotate()
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
