import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminRequestsModal from "~/app/_components/modal/admin-requests-modal";

const { toastMock, validateMutateAsync, rejectMutateAsync } = vi.hoisted(
  () => ({
    toastMock: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    validateMutateAsync: vi.fn(),
    rejectMutateAsync: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@acme/ui/toast", () => ({ toast: toastMock }));

vi.mock("~/utils/store/modal", () => ({
  closeModal: vi.fn(),
}));

vi.mock("~/utils/image/upload-logo", () => ({
  uploadLogo: vi.fn(),
}));

vi.mock("~/app/_components/forms/location-event-form", () => ({
  LocationEventForm: () => null,
  FormDebugData: () => null,
}));

// Bypass react-hook-form so clicking Approve always reaches the submit
// handler with valid values.
vi.mock("~/utils/forms", () => ({
  useUpdateLocationForm: () => ({
    watch: () => "request-1",
    reset: vi.fn(),
    setError: vi.fn(),
    handleSubmit:
      (
        onValid: (values: Record<string, unknown>) => Promise<void>,
        _onInvalid?: unknown,
      ) =>
      () =>
        onValid({
          id: "request-1",
          regionId: 1,
          eventStartTime: "05:30",
          eventEndTime: "06:15",
        }),
  }),
}));

vi.mock("@acme/ui/form", () => ({
  Form: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/orpc/react", () => ({
  ORPCError: class ORPCError extends Error {},
  invalidateQueries: vi.fn(),
  useQuery: (options: { queryKey: string[] }) => {
    if (options.queryKey.includes("request.byId")) {
      return {
        data: {
          request: {
            id: "request-1",
            requestType: "edit",
            regionId: 1,
          },
        },
      };
    }
    return { data: [] };
  },
  useMutation: (options: { mutationKey: string[] }) => {
    if (options.mutationKey.includes("request.validateSubmissionByAdmin")) {
      return { mutateAsync: validateMutateAsync };
    }
    return { mutateAsync: rejectMutateAsync };
  },
  orpc: {
    request: {
      byId: {
        queryOptions: (input: unknown) => ({
          queryKey: ["request.byId"],
          input,
        }),
      },
      validateSubmissionByAdmin: {
        mutationOptions: () => ({
          mutationKey: ["request.validateSubmissionByAdmin"],
        }),
      },
      rejectSubmission: {
        mutationOptions: () => ({
          mutationKey: ["request.rejectSubmission"],
        }),
      },
    },
    eventType: {
      all: {
        queryOptions: (input: unknown) => ({
          queryKey: ["eventType.all"],
          input,
        }),
      },
    },
  },
}));

const renderModal = () =>
  render(<AdminRequestsModal data={{ id: "request-1" }} />);

describe("AdminRequestsModal review feedback toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a success (non-error) toast when a reject succeeds (AC-13)", async () => {
    rejectMutateAsync.mockResolvedValue({ status: "rejected" });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Rejected update");
    });
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows 'Approved update' when the approval is applied (status approved)", async () => {
    validateMutateAsync.mockResolvedValue({ status: "approved" });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("Approved update");
    });
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("surfaces further review instead of 'Approved update' when the approval is re-recorded as pending (AC-17)", async () => {
    validateMutateAsync.mockResolvedValue({ status: "pending" });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith(
        "You don't have permission for every affected region — the request was submitted for further review",
      );
    });
    expect(toastMock.success).not.toHaveBeenCalledWith("Approved update");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
