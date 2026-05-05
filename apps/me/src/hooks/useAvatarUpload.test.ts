import { describe, it, expect } from "vitest";
import {
  validateAvatarFile,
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
} from "./useAvatarUpload";

// ---------------------------------------------------------------------------
// validateAvatarFile
// ---------------------------------------------------------------------------

function makeFile(size: number, type: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], "test-file", { type });
}

describe("validateAvatarFile", () => {
  it("returns null for a valid JPEG under 5MB", () => {
    const file = makeFile(1024, "image/jpeg");
    expect(validateAvatarFile(file)).toBeNull();
  });

  it("returns null for a valid PNG under 5MB", () => {
    const file = makeFile(1024, "image/png");
    expect(validateAvatarFile(file)).toBeNull();
  });

  it("returns null for a valid WebP under 5MB", () => {
    const file = makeFile(1024, "image/webp");
    expect(validateAvatarFile(file)).toBeNull();
  });

  it("returns error for file exceeding 5MB", () => {
    const file = makeFile(MAX_FILE_SIZE + 1, "image/jpeg");
    const error = validateAvatarFile(file);

    expect(error).not.toBeNull();
    expect(error?.title).toBe("File too large");
    expect(error?.description).toContain("5MB");
  });

  it("returns null for file exactly at 5MB", () => {
    const file = makeFile(MAX_FILE_SIZE, "image/jpeg");
    expect(validateAvatarFile(file)).toBeNull();
  });

  it("returns error for GIF files", () => {
    const file = makeFile(1024, "image/gif");
    const error = validateAvatarFile(file);

    expect(error).not.toBeNull();
    expect(error?.title).toBe("Invalid file type");
  });

  it("returns error for SVG files", () => {
    const file = makeFile(1024, "image/svg+xml");
    expect(validateAvatarFile(file)).not.toBeNull();
  });

  it("returns error for PDF files", () => {
    const file = makeFile(1024, "application/pdf");
    expect(validateAvatarFile(file)).not.toBeNull();
  });

  it("returns error for text files", () => {
    const file = makeFile(100, "text/plain");
    expect(validateAvatarFile(file)).not.toBeNull();
  });

  it("returns size error before type error when both fail", () => {
    const file = makeFile(MAX_FILE_SIZE + 1, "image/gif");
    const error = validateAvatarFile(file);
    // Size check comes first in the function
    expect(error?.title).toBe("File too large");
  });

  it("returns null for zero-byte valid type file", () => {
    const file = makeFile(0, "image/jpeg");
    expect(validateAvatarFile(file)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("MAX_FILE_SIZE is 5MB", () => {
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });

  it("ALLOWED_TYPES contains exactly jpeg, png, webp", () => {
    expect(ALLOWED_TYPES.size).toBe(3);
    expect(ALLOWED_TYPES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_TYPES.has("image/png")).toBe(true);
    expect(ALLOWED_TYPES.has("image/webp")).toBe(true);
    expect(ALLOWED_TYPES.has("image/gif")).toBe(false);
  });
});
