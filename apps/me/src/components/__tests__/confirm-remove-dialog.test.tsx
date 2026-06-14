import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfirmRemoveDialog } from "../confirm-remove-dialog";

describe("ConfirmRemoveDialog", () => {
  it("renders with title and description when open", () => {
    render(
      <ConfirmRemoveDialog
        open={true}
        title="Test Title"
        description="Test Description"
        actionText="Confirm"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Test Title")).toBeDefined();
    expect(screen.getByText("Test Description")).toBeDefined();
  });

  it("calls onConfirm when action button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmRemoveDialog
        open={true}
        title="Test"
        description="Test"
        actionText="Confirm"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    confirmButton.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
