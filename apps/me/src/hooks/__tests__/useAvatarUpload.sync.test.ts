import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAvatarUpload } from "../useAvatarUpload";

afterEach(cleanup);

describe("useAvatarUpload previewUrl sync", () => {
  it("follows currentUrl when the parent passes a new one", () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useAvatarUpload>,
      { currentUrl: string | null }
    >((props) => useAvatarUpload({ ...props, onUploaded: () => undefined }), {
      initialProps: { currentUrl: "https://x.test/a.png" },
    });
    expect(result.current.previewUrl).toBe("https://x.test/a.png");

    rerender({ currentUrl: "https://x.test/b.png" });
    expect(result.current.previewUrl).toBe("https://x.test/b.png");

    rerender({ currentUrl: null });
    expect(result.current.previewUrl).toBeNull();
  });
});
