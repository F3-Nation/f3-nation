import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface TestKey {
  id: number;
  name: string;
  description: string | null;
  keySignature: string;
  ownerName: string | null;
  ownerEmail: string | null;
  roles: { orgId: number; orgName: string; roleName: "admin" | "editor" }[];
  revokedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  created: string;
  canManage: boolean;
}

type MutationKey = "revoke" | "purge";

interface MutationOptions {
  onSuccess?: (result: unknown, variables?: unknown) => Promise<void>;
  onError?: () => void;
}

const mocks = vi.hoisted(() => {
  const options: Partial<Record<MutationKey, MutationOptions>> = {};
  return {
    isLoading: false,
    apiKeys: [] as unknown[],
    mutate: { revoke: vi.fn(), purge: vi.fn() },
    options,
    invalidateQueries: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock("~/orpc/react", () => ({
  orpc: {
    apiKey: {
      list: { queryOptions: () => ({}) },
      revoke: {
        mutationOptions: (opts: MutationOptions) => ({
          __key: "revoke",
          ...opts,
        }),
      },
      purge: {
        mutationOptions: (opts: MutationOptions) => ({
          __key: "purge",
          ...opts,
        }),
      },
    },
  },
  useQuery: () => ({
    data: { apiKeys: mocks.apiKeys },
    isLoading: mocks.isLoading,
  }),
  useMutation: (opts: MutationOptions & { __key: MutationKey }) => {
    mocks.options[opts.__key] = opts;
    return { mutate: mocks.mutate[opts.__key] };
  },
  invalidateQueries: mocks.invalidateQueries,
}));

vi.mock("@acme/ui/toast", () => ({ toast: mocks.toast }));

// Radix menus need pointer events jsdom lacks; render the items inline so the
// test exercises the table's own branching rather than the menu primitive.
vi.mock("@acme/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

import { ApiKeysTable } from "./api-keys-table";

const makeKey = (overrides: Partial<TestKey> = {}): TestKey => ({
  id: 1,
  name: "Key one",
  description: null,
  keySignature: "abcd",
  ownerName: "Pat Owner",
  ownerEmail: "pat@example.com",
  roles: [],
  revokedAt: null,
  expiresAt: null,
  lastUsedAt: null,
  created: "2026-01-01T00:00:00.000Z",
  canManage: true,
  ...overrides,
});

describe("ApiKeysTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLoading = false;
    mocks.apiKeys = [];
    mocks.options = {};
  });

  it("shows a spinner while loading and the empty state with no keys", () => {
    mocks.isLoading = true;
    const { rerender } = render(<ApiKeysTable />);
    expect(screen.queryByText("No API keys yet.")).toBeNull();

    mocks.isLoading = false;
    rerender(<ApiKeysTable />);
    expect(screen.getByText("No API keys yet.")).toBeTruthy();
  });

  it("offers revoke and delete on an active key the user can manage", () => {
    mocks.apiKeys = [makeKey()];
    render(<ApiKeysTable />);

    fireEvent.click(screen.getByText("Revoke access"));
    expect(mocks.mutate.revoke).toHaveBeenCalledWith({ id: 1, revoke: true });
    expect(screen.getByText("Delete key")).toBeTruthy();
  });

  it("offers restore and delete on a revoked key the user can manage", () => {
    mocks.apiKeys = [makeKey({ revokedAt: "2026-02-01T00:00:00.000Z" })];
    render(<ApiKeysTable />);

    fireEvent.click(screen.getByText("Restore access"));
    expect(mocks.mutate.revoke).toHaveBeenCalledWith({ id: 1, revoke: false });
    expect(screen.getByText("Delete key")).toBeTruthy();
  });

  it("lets a non-manager revoke an active key but not delete it", () => {
    mocks.apiKeys = [makeKey({ canManage: false })];
    render(<ApiKeysTable />);

    expect(screen.getByText("Revoke access")).toBeTruthy();
    expect(screen.queryByText("Delete key")).toBeNull();
  });

  it("hides the row menu for a revoked key the user cannot manage", () => {
    mocks.apiKeys = [
      makeKey({ canManage: false, revokedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    render(<ApiKeysTable />);

    expect(screen.queryByText("Restore access")).toBeNull();
    expect(screen.queryByText("Revoke access")).toBeNull();
    expect(screen.queryByText("Delete key")).toBeNull();
  });

  it("deletes only after the user confirms", () => {
    mocks.apiKeys = [makeKey()];
    const confirm = vi.spyOn(window, "confirm");
    render(<ApiKeysTable />);

    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText("Delete key"));
    expect(mocks.mutate.purge).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByText("Delete key"));
    expect(mocks.mutate.purge).toHaveBeenCalledWith({ id: 1 });
    confirm.mockRestore();
  });

  it("derives the status badge and renders scope roles", () => {
    mocks.apiKeys = [
      makeKey({
        id: 1,
        name: "Expired key",
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
      makeKey({
        id: 2,
        name: "Scoped key",
        description: "for the bot",
        ownerName: null,
        ownerEmail: null,
        roles: [{ orgId: 9, orgName: "Region 9", roleName: "editor" }],
      }),
    ];
    render(<ApiKeysTable />);

    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Region 9 (Editor)")).toBeTruthy();
    expect(screen.getByText("for the bot")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
  });

  it("toasts and refreshes after mutations settle", async () => {
    mocks.apiKeys = [makeKey()];
    render(<ApiKeysTable />);

    const revoke = mocks.options.revoke!;
    await revoke.onSuccess?.({}, { revoke: true });
    await revoke.onSuccess?.({}, { revoke: false });
    revoke.onError?.();
    expect(mocks.toast.success).toHaveBeenCalledWith("API key revoked");
    expect(mocks.toast.success).toHaveBeenCalledWith("API key reactivated");
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Unable to update API key status",
    );

    const purge = mocks.options.purge!;
    await purge.onSuccess?.({});
    purge.onError?.();
    expect(mocks.toast.success).toHaveBeenCalledWith("API key deleted");
    expect(mocks.toast.error).toHaveBeenCalledWith("Unable to delete API key");
    expect(mocks.invalidateQueries).toHaveBeenCalledWith("apiKey");
  });
});
