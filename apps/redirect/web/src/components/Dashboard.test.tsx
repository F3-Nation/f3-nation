// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  addPasskey: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
}));
vi.mock("@/lib/auth-client", () => ({
  signOut: h.signOut,
  passkey: { addPasskey: h.addPasskey },
}));

import { Dashboard } from "./Dashboard";

const apexDns = [
  {
    type: "A",
    name: "x.com",
    value: "34.172.36.60",
    note: "required",
    optional: false,
  },
];

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  h.push.mockReset();
  h.addPasskey.mockReset();
  // Stub rather than assign so the mocked fetch is torn down per suite and
  // doesn't leak into later Vitest files/workers (avoids order-dependence).
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dashboard", () => {
  it("registers a domain (POST) and renders the new card", async () => {
    render(<Dashboard initial={[]} userEmail="a@b.com" />);
    mockFetchOnce(201, {
      domain: {
        id: "1",
        hostname: "x.com",
        destination: "https://y.com",
        dns: apexDns,
      },
    });

    await userEvent.type(screen.getByLabelText("Custom domain"), "x.com");
    await userEvent.type(
      screen.getByLabelText("Redirect destination"),
      "https://y.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Register domain" }),
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/domains",
      expect.objectContaining({ method: "POST" }),
    );
    // Assert on the destination (unique to the card; the hostname also appears
    // in the always-rendered DNS-sheet markup).
    expect(
      await screen.findByText("https://y.com", { exact: false }),
    ).toBeInTheDocument();
  });

  it("surfaces the 'already claimed' error from the API", async () => {
    render(<Dashboard initial={[]} userEmail="a@b.com" />);
    mockFetchOnce(409, {
      error: "this domain is already claimed by another account",
    });

    await userEvent.type(screen.getByLabelText("Custom domain"), "x.com");
    await userEvent.type(
      screen.getByLabelText("Redirect destination"),
      "https://y.com",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Register domain" }),
    );

    expect(
      await screen.findByText(/already claimed by another account/i),
    ).toBeInTheDocument();
  });

  it("edits a destination in place (PUT) and shows the new value", async () => {
    render(
      <Dashboard
        initial={[
          {
            id: "1",
            hostname: "x.com",
            destination: "https://old.com",
            dns: apexDns,
          },
        ]}
        userEmail="a@b.com"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit destination" }),
    );
    const input = screen.getByDisplayValue("https://old.com"); // the card's edit input
    await userEvent.clear(input);
    await userEvent.type(input, "https://new.com");

    mockFetchOnce(200, {
      domain: {
        id: "1",
        hostname: "x.com",
        destination: "https://new.com",
        dns: apexDns,
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/domains/1",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(
      await screen.findByText("https://new.com", { exact: false }),
    ).toBeInTheDocument();
  });

  it("removes a domain (DELETE) and the card disappears", async () => {
    render(
      <Dashboard
        initial={[
          {
            id: "1",
            hostname: "gone.com",
            destination: "https://z.com",
            dns: apexDns,
          },
        ]}
        userEmail="a@b.com"
      />,
    );
    mockFetchOnce(200, { ok: true });

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/domains/1",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("gone.com")).not.toBeInTheDocument(),
    );
  });

  it("adds a passkey and confirms", async () => {
    render(<Dashboard initial={[]} userEmail="a@b.com" />);
    h.addPasskey.mockResolvedValue({});

    await userEvent.click(
      screen.getByRole("button", { name: "Add a passkey" }),
    );

    expect(h.addPasskey).toHaveBeenCalled();
    expect(await screen.findByText(/passkey added/i)).toBeInTheDocument();
  });
});
