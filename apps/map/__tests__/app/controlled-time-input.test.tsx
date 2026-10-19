import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { ControlledTimeInput } from "~/app/_components/forms/form-inputs/controlled-time-input";

const Harness = () => {
  const form = useForm({ defaultValues: { eventStartTime: "0530" } });
  return (
    <FormProvider {...form}>
      <ControlledTimeInput name="eventStartTime" label="Start Time" />
    </FormProvider>
  );
};

describe("ControlledTimeInput", () => {
  it("renders the stored time with its form label", () => {
    render(<Harness />);

    expect(screen.getByText("Start Time")).toBeInTheDocument();
    expect(screen.getByDisplayValue("05:30")).toHaveAttribute("type", "time");
  });
});
