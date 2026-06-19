import { describe, expect, it, vi } from "vitest";

const uploadUserAvatarMock = vi.fn();

vi.mock("@/lib/storage", () => ({
  storage: {
    uploadUserAvatar: uploadUserAvatarMock,
  },
}));

import { uploadAvatar } from "@/lib/gcs";

describe("uploadAvatar", () => {
  it("delegates to storage.uploadUserAvatar and returns URL", async () => {
    uploadUserAvatarMock.mockResolvedValueOnce(
      "https://storage.googleapis.com/f3-public-images/user-avatars/42.jpg",
    );

    const result = await uploadAvatar(42, Buffer.from("image-bytes"));

    expect(uploadUserAvatarMock).toHaveBeenCalledWith(
      42,
      Buffer.from("image-bytes"),
    );
    expect(result).toBe(
      "https://storage.googleapis.com/f3-public-images/user-avatars/42.jpg",
    );
  });
});
