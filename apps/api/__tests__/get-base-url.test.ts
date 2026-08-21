import { afterEach, describe, expect, it } from "vitest";

import { getBaseUrl } from "../src/lib/get-base-url";

describe("getBaseUrl", () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it("treats a blank NEXT_PUBLIC_API_URL as unset and falls back to forwarded headers", () => {
    process.env.NEXT_PUBLIC_API_URL = "   ";

    const result = getBaseUrl(
      new Request("http://internal.local/", {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "api.example.com",
        },
      }),
    );

    expect(result).toBe("https://api.example.com");
  });

  it("treats an empty-string NEXT_PUBLIC_API_URL as unset and falls back to the request URL", () => {
    process.env.NEXT_PUBLIC_API_URL = "";

    const result = getBaseUrl(new Request("http://localhost:3001/"));

    expect(result).toBe("http://localhost:3001");
  });
});
