import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { ControlledTimeInput } from "~/app/_components/forms/form-inputs/controlled-time-input";

let stored: unknown;

const Harness = () => {
  const form = useForm({ defaultValues: { eventStartTime: "0530" } });
  stored = useWatch({ control: form.control, name: "eventStartTime" });
  return (
    <FormProvider {...form}>
      <ControlledTimeInput name="eventStartTime" label="Start Time" />
    </FormProvider>
  );
};

describe("ControlledTimeInput", () => {
  it("links the label to the time input and shows the stored time", () => {
    render(<Harness />);

    const input = screen.getByLabelText<HTMLInputElement>("Start Time");
    expect(input).toHaveAttribute("type", "time");
    expect(input).toHaveValue("05:30");
  });

  it("stores the edited time without the colon", () => {
    render(<Harness />);

    const input = screen.getByLabelText<HTMLInputElement>("Start Time");
    fireEvent.change(input, { target: { value: "06:15" } });

    expect(stored).toBe("0615");
    expect(input).toHaveValue("06:15");
  });

  it("links each label to its own input when both are rendered", () => {
    let values: Record<string, unknown> = {};
    const Pair = () => {
      const form = useForm({
        defaultValues: { eventStartTime: "0530", eventEndTime: "0615" },
      });
      values = useWatch({ control: form.control });
      return (
        <FormProvider {...form}>
          <ControlledTimeInput name="eventStartTime" label="Start Time" />
          <ControlledTimeInput name="eventEndTime" label="End Time" />
        </FormProvider>
      );
    };
    render(<Pair />);

    const start = screen.getByLabelText<HTMLInputElement>("Start Time");
    const end = screen.getByLabelText<HTMLInputElement>("End Time");
    expect(start).not.toBe(end);
    expect(start.id).not.toBe(end.id);

    fireEvent.change(end, { target: { value: "07:00" } });
    expect(values).toEqual({ eventStartTime: "0530", eventEndTime: "0700" });
  });

  it("stores an empty string when the time is cleared", () => {
    render(<Harness />);

    const input = screen.getByLabelText<HTMLInputElement>("Start Time");
    fireEvent.change(input, { target: { value: "" } });

    expect(stored).toBe("");
    expect(input).toHaveValue("");
  });
});
