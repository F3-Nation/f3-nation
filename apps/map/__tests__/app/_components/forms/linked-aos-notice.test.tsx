import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LinkedAosNotice } from "../../../../src/app/_components/forms/linked-aos-notice";

interface MockQueryResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const useQueryMock = vi.hoisted(() => vi.fn<() => MockQueryResult>());

vi.mock("~/orpc/react", () => ({
  useQuery: (): MockQueryResult => useQueryMock(),
  orpc: {
    location: {
      linkedAos: { queryOptions: (opts: unknown) => opts },
    },
  },
}));

vi.mock("~/utils/store/modal", () => ({ closeModal: vi.fn() }));
vi.mock("~/utils/open-request-modal", () => ({
  openRequestModal: vi.fn(),
}));

describe("LinkedAosNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports unresolved while the check is loading (fail closed)", () => {
    const onSharedChange = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      <LinkedAosNotice
        locationId={1}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={onSharedChange}
      />,
    );
    expect(onSharedChange).toHaveBeenCalledWith({
      resolved: false,
      shared: false,
    });
  });

  it("reports unresolved on error (fail closed) and shows a retry", () => {
    const onSharedChange = vi.fn();
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    render(
      <LinkedAosNotice
        locationId={1}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={onSharedChange}
      />,
    );
    expect(onSharedChange).toHaveBeenCalledWith({
      resolved: false,
      shared: false,
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("re-closes the gate when a refetch fails after an earlier successful resolution", () => {
    const onSharedChange = vi.fn();
    useQueryMock.mockReturnValue({
      data: { totalAoCount: 1, aos: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const { rerender } = render(
      <LinkedAosNotice
        locationId={1}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={onSharedChange}
      />,
    );
    expect(onSharedChange).toHaveBeenLastCalledWith({
      resolved: true,
      shared: false,
    });

    // A later background refetch (e.g. window refocus) fails — stale `data`
    // is still present (TanStack Query default), but isError flips true.
    onSharedChange.mockClear();
    useQueryMock.mockReturnValue({
      data: { totalAoCount: 1, aos: [] },
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    rerender(
      <LinkedAosNotice
        locationId={1}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={onSharedChange}
      />,
    );
    expect(onSharedChange).toHaveBeenLastCalledWith({
      resolved: false,
      shared: false,
    });
  });

  it("reports not-shared once resolved with a single AO", () => {
    const onSharedChange = vi.fn();
    useQueryMock.mockReturnValue({
      data: {
        totalAoCount: 1,
        aos: [
          {
            aoId: 1,
            aoName: "The Forge",
            aoLogo: null,
            eventCount: 1,
            events: [
              {
                id: 1,
                name: "Beatdown",
                dayOfWeek: "monday",
                startTime: "0530",
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      <LinkedAosNotice
        locationId={1}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={onSharedChange}
      />,
    );
    expect(onSharedChange).toHaveBeenCalledWith({
      resolved: true,
      shared: false,
    });
  });

  it("reports shared and renders the warning + checkbox when totalAoCount > 1", () => {
    const onSharedChange = vi.fn();
    useQueryMock.mockReturnValue({
      data: {
        totalAoCount: 2,
        aos: [
          {
            aoId: 1,
            aoName: "The Forge",
            aoLogo: null,
            eventCount: 1,
            events: [
              {
                id: 1,
                name: "Beatdown",
                dayOfWeek: "monday",
                startTime: "0530",
              },
            ],
          },
          {
            aoId: 2,
            aoName: "The Anvil",
            aoLogo: null,
            eventCount: 1,
            // Null dayOfWeek/startTime — must not crash and must not render
            // dangling empty parens.
            events: [{ id: 2, name: null, dayOfWeek: null, startTime: null }],
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      <LinkedAosNotice
        locationId={1}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={onSharedChange}
      />,
    );
    expect(onSharedChange).toHaveBeenCalledWith({
      resolved: true,
      shared: true,
    });
    expect(screen.getByText(/shared by 2 AOs/)).toBeInTheDocument();
    expect(screen.getByText("Workout")).toBeInTheDocument();
    expect(screen.getByText("Workout").textContent).toBe("Workout");
  });

  it("renders nothing when locationId is null", () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const { container } = render(
      <LinkedAosNotice
        locationId={undefined}
        acknowledged={false}
        onAcknowledgeChange={vi.fn()}
        onSharedChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
