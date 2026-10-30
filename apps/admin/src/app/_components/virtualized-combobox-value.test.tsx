import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VirtualizedCombobox } from "@acme/ui/virtualized-combobox";

afterEach(cleanup);

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

describe("VirtualizedCombobox value sync", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(<VirtualizedCombobox options={options} searchPlaceholder="Pick" />);
    expect(screen.getByRole("combobox").textContent).toContain("Pick");
  });

  it("follows the `value` prop when it changes (string and array)", () => {
    const { rerender } = render(
      <VirtualizedCombobox options={options} value="a" />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Alpha");

    rerender(<VirtualizedCombobox options={options} value="b" />);
    expect(screen.getByRole("combobox").textContent).toContain("Bravo");

    rerender(
      <VirtualizedCombobox options={options} value={["c", "a"]} isMulti />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Charlie");
    expect(screen.getByRole("combobox").textContent).toContain("+1");

    rerender(<VirtualizedCombobox options={options} value={[]} isMulti />);
    expect(screen.getByRole("combobox").textContent).not.toContain("Charlie");
  });
});
