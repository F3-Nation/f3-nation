import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { processAvatarImage } from "@/lib/gcs";

/**
 * Regression test for #315: portrait selfies from Android phones are stored as
 * landscape pixel data plus an EXIF Orientation tag (value 6 = "rotate 90° CW
 * to display"). If the avatar pipeline reads the raw pixels without honoring
 * EXIF, the saved avatar is rotated 90° CW from what the user saw.
 *
 * We build a wide (landscape) image whose LEFT half is red and RIGHT half is
 * blue, then tag it Orientation=6 WITHOUT rotating the pixels — exactly how a
 * phone stores a portrait photo. When orientation is honored (rotate 90° CW),
 * the left column maps to the TOP, so the processed square avatar should be
 * red on top / blue on bottom. The un-rotated (buggy) output is red on the
 * left / blue on the right, so each half is ~50/50 and the assertions fail.
 */

const RED = { r: 255, g: 0, b: 0 } as const;
const BLUE = { r: 0, g: 0, b: 255 } as const;

/** A 1024x512 landscape image, left half red / right half blue, tagged EXIF orientation 6. */
async function makePortraitSelfieFixture(): Promise<Buffer> {
  const width = 1024;
  const height = 512;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const color = x < width / 2 ? RED : BLUE;
      raw[i] = color.r;
      raw[i + 1] = color.g;
      raw[i + 2] = color.b;
    }
  }
  return sharp(raw, { raw: { width, height, channels } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

/** Mean red/green/blue channel values over a region of raw RGB pixels. */
interface MeanRgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Compute the mean RGB of a horizontal band of a raw RGB buffer, from row
 * `yStart` (inclusive) to `yEnd` (exclusive) across the full width. Used to
 * assert which color dominates the top vs. bottom half of the processed avatar.
 */
function meanRgb(
  data: Buffer,
  width: number,
  channels: number,
  yStart: number,
  yEnd: number,
): MeanRgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

describe("processAvatarImage — EXIF orientation (#315)", () => {
  it("honors EXIF orientation so portrait selfies are not rotated 90°", async () => {
    const fixture = await makePortraitSelfieFixture();

    const out = await processAvatarImage(fixture);

    const { data, info } = await sharp(out)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(512);
    expect(info.height).toBe(512);

    const top = meanRgb(data, info.width, info.channels, 0, info.height / 2);
    const bottom = meanRgb(
      data,
      info.width,
      info.channels,
      info.height / 2,
      info.height,
    );

    // Orientation 6 rotates the stored landscape 90° CW: the red LEFT column
    // becomes the TOP, blue becomes the BOTTOM. If EXIF is ignored, each half
    // is ~half-red/half-blue and these margins collapse.
    expect(top.r - top.b).toBeGreaterThan(80);
    expect(bottom.b - bottom.r).toBeGreaterThan(80);
  });

  it("produces a 512x512 JPEG", async () => {
    const fixture = await makePortraitSelfieFixture();
    const out = await processAvatarImage(fixture);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });
});
