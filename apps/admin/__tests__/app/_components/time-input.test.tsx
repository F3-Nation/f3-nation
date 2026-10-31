import { act, fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { Form } from "@acme/ui/form";

import { ControlledTimeInput } from "~/app/_components/time-input";

interface Values {
  t: string;
}

let api: ReturnType<typeof useForm<Values>>;

const Harness = () => {
  api = useForm<Values>({ defaultValues: { t: "05:30" } });
  return (
    <Form {...api}>
      <ControlledTimeInput control={api.control} name="t" label="Start Time" />
    </Form>
  );
};

describe("ControlledTimeInput", () => {
  it("is named by its label and links its error message", async () => {
    render(<Harness />);
    const input = screen.getByLabelText<HTMLInputElement>("Start Time");
    expect(input.type).toBe("time");
    expect(input.value).toBe("05:30");
    expect(input.getAttribute("aria-invalid")).toBe("false");

    act(() => {
      api.setError("t", { message: "bad time" });
    });
    const message = await screen.findByText("bad time");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(
      message.id,
    );
  });

  it("writes changes back to the form", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Start Time"), {
      target: { value: "06:15" },
    });
    expect(api.getValues("t")).toBe("06:15");
  });
});
