import { afterEach, describe, expect, it, vi } from "vitest";

import { createEtherealTestAccount } from "./ethereal";

describe("createEtherealTestAccount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a new ethereal account and returns credentials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          user: "ethereal-user",
          pass: "ethereal-pass",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(createEtherealTestAccount()).resolves.toEqual({
      user: "ethereal-user",
      pass: "ethereal-pass",
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://api.nodemailer.com/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestor: "nodemailer", version: "6.10.0" }),
    });
  });

  it("throws when ethereal account creation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "oops" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createEtherealTestAccount()).rejects.toThrow(
      "Failed to create Ethereal test account: oops",
    );
  });
});
