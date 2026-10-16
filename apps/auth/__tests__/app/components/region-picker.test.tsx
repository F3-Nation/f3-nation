// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, useState } from "react";
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

  it("ignores Escape when the list is already closed", () => {
    const box = setup();
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the typed text for a click that lands after the blur", async () => {
    vi.useFakeTimers();
    try {
      const box = setup();
      fireEvent.change(box, { target: { value: "other" } });
      fireEvent.mouseDown(screen.getByRole("option", { name: "Other" }));
      fireEvent.blur(box);
      await act(() => vi.advanceTimersByTimeAsync(300));

      expect(box).toHaveProperty("value", "other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't let an earlier blur wipe a region picked with the keyboard", async () => {
    vi.useFakeTimers();
    try {
      const box = setup();
      fireEvent.change(box, { target: { value: "other" } });
      // Focus leaves, then returns and picks before the blur timer fires.
      fireEvent.blur(box);
      fireEvent.focus(box);
      fireEvent.keyDown(box, { key: "Enter" });
      await act(() => vi.advanceTimersByTimeAsync(300));

      expect(onChange).toHaveBeenLastCalledWith(3);
      expect(box).toHaveProperty("value", "Other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("picks with the mouse while a blur is still pending", async () => {
    vi.useFakeTimers();
    try {
      const box = setup();
      fireEvent.change(box, { target: { value: "other" } });
      const option = screen.getByRole("option", { name: "Other" });
      fireEvent.mouseDown(option);
      fireEvent.blur(box);
      fireEvent.click(option);
      await act(() => vi.advanceTimersByTimeAsync(300));

      expect(onChange).toHaveBeenLastCalledWith(3);
      expect(box).toHaveProperty("value", "Other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the chosen name when focus leaves without a new pick", async () => {
    vi.useFakeTimers();
    try {
      const box = setup();
      fireEvent.change(box, { target: { value: "other" } });
      fireEvent.keyDown(box, { key: "Enter" });
      fireEvent.change(box, { target: { value: "oth" } });
      fireEvent.keyDown(box, { key: "Enter" });
      fireEvent.focus(box);
      fireEvent.blur(box);
      await act(() => vi.advanceTimersByTimeAsync(300));

      expect(box).toHaveProperty("value", "Other");
    } finally {
      vi.useRealTimers();
    }
  });
});
