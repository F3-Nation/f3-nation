import { beforeEach, describe, expect, it, vi } from "vitest";

import UserEditPage from "./page";

const mocks = vi.hoisted(() => ({
  byId: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("~/orpc/client", () => ({ client: { user: { byId: mocks.byId } } }));
vi.mock("./user-mutate", () => ({ default: () => null }));

function renderPage(id: string) {
  return UserEditPage({ params: Promise.resolve({ id }) });
}

describe("UserEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["abc", "1.5", "-1", "2147483648"])(
    "404s on id %s without calling the API",
    async (id) => {
      await expect(renderPage(id)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.byId).not.toHaveBeenCalled();
    },
  );

  it("404s when the user does not exist", async () => {
    mocks.byId.mockResolvedValue({ user: null, includePii: true });
    await expect(renderPage("7")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.byId).toHaveBeenCalledWith({ id: 7, includePii: true });
  });

  it("renders the form for an existing user", async () => {
    const user = { id: 7 };
    mocks.byId.mockResolvedValue({ user, includePii: true });
    const element = await renderPage("7");
    expect(element.props).toEqual({ user });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("lets API errors reach the error boundary", async () => {
    mocks.byId.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(renderPage("7")).rejects.toThrow("UNAUTHORIZED");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
