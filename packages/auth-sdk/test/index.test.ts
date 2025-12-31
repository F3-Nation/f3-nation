import { describe, it, expect } from "vitest";
import { AuthClient } from "../src";

const mockConfig = {
  client: {
    CLIENT_ID: "test-client-id",
    CLIENT_SECRET: "test-client-secret",
    REDIRECT_URI: "https://test.com/callback",
    AUTH_SERVER_URL: "https://example.com",
  },
};

describe("AuthClient", () => {
  it("should instantiate with a config", () => {
    const client = new AuthClient(mockConfig);
    expect(client).toBeInstanceOf(AuthClient);
  });

  it("loginWithEmail throws not implemented", async () => {
    const client = new AuthClient(mockConfig);
    await expect(client.loginWithEmail("test@example.com", "pw")).rejects.toThrow(
      "Not implemented",
    );
  });
});
