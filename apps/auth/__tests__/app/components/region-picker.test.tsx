// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Region } from "~/app/components/region-picker";
import { RegionPicker } from "~/app/components/region-picker";

const regions: Region[] = [
  { id: 1, name: "Test North" },
  { id: 2, name: "Test South" },
  { id: 3, name: "Other" },
];

const onChange = vi.fn();

function Harness() {
  const [value, setValue] = useState<number | "">("");
  const [search, setSearch] = useState("");
  return (
    <form data-testid="form" onSubmit={(e) => e.preventDefault()}>
      <RegionPicker
        regions={regions}
        value={value}
        onChange={(id) => {
          onChange(id);
          setValue(id);
        }}
        search={search}
        onSearchChange={setSearch}
        inputClass=""
        placeholder="Search"
      />
    </form>
  );
}

function setup() {
  render(<Harness />);
  const box = screen.getByRole("combobox");
  fireEvent.focus(box);
  return box;
}

afterEach(() => {
  cleanup();
  onChange.mockClear();
});

describe("RegionPicker keyboard use", () => {
  it("moves through the options with the arrow keys and picks with Enter", () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "test" } });
    expect(box.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.getAttribute("aria-activedescendant")).toBe(
      "homeRegion-option-1",
    );
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(box).toHaveProperty("value", "Test North");
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("wraps from the first option back to the last", () => {
    const box = setup();
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.getAttribute("aria-activedescendant")).toBe(
      "homeRegion-option-3",
    );
  });

  it("picks the only match on Enter and doesn't submit the form", () => {
    const box = setup();
    const submit = vi.fn();
    screen.getByTestId("form").addEventListener("submit", submit);
    fireEvent.change(box, { target: { value: "other" } });

    const notPrevented = fireEvent.keyDown(box, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it("doesn't guess among several matches on Enter", () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "test" } });
    onChange.mockClear();

    fireEvent.keyDown(box, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes the list on Escape", () => {
    const box = setup();
    expect(box.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("ignores arrows when nothing matches", () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "zzz" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByText("No regions found")).toBeDefined();
    expect(box.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("keeps what was typed when focus moves into the list", () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "test" } });
    const option = screen.getByRole("button", { name: "Test North" });

    fireEvent.blur(box, { relatedTarget: option });

    expect(box).toHaveProperty("value", "test");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});
